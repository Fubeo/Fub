//! Il campionatore: `VersioningHandler`, l'`EventHandler` che fotografa le
//! note quando cambiano.

use super::*;

/// Il campionatore: un [`EventHandler`] come quelli che scriveranno i plugin.
///
/// Non scrive nel vault e non emette eventi — legge e basta — quindi non può
/// innescare il ping-pong che il budget del dispatch è lì a troncare.
pub struct VersioningHandler {
    store: VersionStore,
}

impl VersioningHandler {
    pub fn new(store: VersionStore) -> Self {
        VersioningHandler { store }
    }

    /// Una passata sull'intero vault, e chi fotografare.
    fn sweep(&self, host: &mut dyn HostApi, who: Pass) -> Result<(), PluginError> {
        let entries = self.existing(host)?;
        // Una passata è un **lotto**: le fotografie vanno sul disco una per una
        // — blob e `meta.json`, che sono l'autorità — e l'indice, che è il
        // derivato, si scrive una volta sola in fondo. Fuori di qui l'indice
        // resta scritto a ogni salvataggio: è il costo onesto di un indice, e
        // diventa un difetto solo quando lo si paga N volte di fila.
        let result = self.store.in_batch(host, |host| {
            for VaultEntry { id, size, .. } in entries {
                if matches!(who, Pass::OnlyNew) && self.store.has_versions(&id) {
                    continue;
                }
                // Oltre il tetto non si legge: la passata sul vault intero è
                // proprio quella che, senza, ricopiava ogni video.
                if size > MAX_VERSION_BYTES {
                    continue;
                }
                // Una nota illeggibile o non salvabile non deve impedire
                // l'apertura del vault: il vault è la verità, le versioni no.
                match host.read_document_bytes(&id) {
                    Ok(source) => {
                        if let Err(and) = self.store.snapshot(&id, &source, host) {
                            tracing::warn!(target: "fub.versioning", "versione di {id} non salvata: {and}");
                            // Una versione attesa non salvata è una perdita
                            // autorevole (0052: `Failure`): l'errore è già un
                            // `PluginError` catalogato, e lo si porta nel canale tale
                            // e quale invece di ricomporlo (0062).
                            host.emit(Event::Trouble {
                                severity: Severity::Failure,
                                subject: Some(id.clone()),
                                error: and,
                                gate: None,
                            });
                        }
                    }
                    Err(and) => {
                        tracing::warn!(target: "fub.versioning", "{id} non si legge: {and}");
                        host.emit(Event::Trouble {
                            severity: Severity::Failure,
                            subject: Some(id.clone()),
                            error: and,
                            gate: None,
                        });
                    }
                }
            }
        });
        // L'indice finale non si è scritto. Non è una versione persa — sul
        // disco le fotografie ci sono tutte e la prossima apertura le
        // ricostruisce — ma non è nemmeno una notizia da tenersi: è lo stesso
        // guasto che prima si presentava una volta per nota, e qui si presenta
        // una volta sola. **Senza soggetto**, perché non è di un documento: è
        // dello store.
        if let Err(and) = result {
            tracing::warn!(
                target: "fub.versioning",
                "l'indice non si è scritto dopo la passata: resta da \
                 ricostruire alla prossima apertura ({and})"
            );
            host.emit(Event::Trouble {
                severity: Severity::Failure,
                subject: None,
                error: and,
                gate: None,
            });
        }
        Ok(())
    }

    /// **Quali documenti esistono**, che non è «quali sono indicizzati».
    ///
    /// La domanda è all'anagrafe ([`IndexQuery::Entries`], §14.1) e non a
    /// [`HostApi::list_documents`], e la differenza è diventata visibile con
    /// l'apertura a fasi (§15.7): `list_documents` risponde dai documenti
    /// **parsati**, e quando la passata parte non ne è stato parsato ancora
    /// nessuno — il vault a quel punto sa *cosa c'è*, non
    /// *cosa dicono*. Chiedendo la lista sbagliata, la prima fotografia
    /// sarebbe stata di zero note, e la prima modifica a una nota mai
    /// versionata avrebbe cancellato per sempre lo stato in cui l'utente
    /// l'aveva trovata: cioè esattamente il danno contro cui questa passata
    /// esiste.
    ///
    /// Che le due liste potessero divergere lo aveva già scritto la
    /// [0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
    /// — uno scarto è un documento che esiste e non è indicizzato — ma là la
    /// divergenza era rara e piccola; qui è la normalità per tutta la durata
    /// dell'indicizzazione. E per questa passata l'anagrafe è la sorgente
    /// giusta anche nel merito: si fotografa ciò che sta **sul disco**, e
    /// `read_document_bytes` legge dal disco, non dall'indice.
    fn existing(&self, host: &mut dyn HostApi) -> Result<Vec<VaultEntry>, PluginError> {
        entries(host, None, None)
    }

    /// La prima fotografia del vault, all'apertura.
    ///
    /// Gli snapshot nascono dagli eventi e l'apertura non ne emette per
    /// documento: senza questo passaggio, la prima modifica a una nota mai
    /// versionata cancellerebbe per sempre lo stato in cui l'utente l'ha
    /// trovata — l'handler gira *dopo* la scrittura e vede solo il testo nuovo.
    ///
    /// **Non la chiama più il runner all'apertura** (0154): la fotografia è
    /// diventata copy-on-first-write, e questo metodo resta come unità
    /// riusabile — i test la chiamano a mano per avere lo stato che il gancio
    /// produce da solo. La riconciliazione dopo un `Overflow` passa da
    /// `sweep(Tutti)`, non da qui: `Tutti` fotografa anche chi non ha storia,
    /// col dedup. Il *quando* e il *cosa* sono policy della feature — viveva
    /// in `fub-app::open_vault`, poi sull'evento `VaultOpened`, poi qui, con
    /// la stessa firma di un `Plugin::activate` — e il *chi* è il wiring.
    pub fn first_snapshot_of_the_vault<'h>(
        &self,
        host: &'h mut (dyn HostApi + 'h),
    ) -> Result<(), PluginError> {
        self.sweep(host, Pass::OnlyNew)
    }

    /// Conserva i byte correnti prima di ogni sovrascrittura.
    ///
    /// Avere già una storia non prova che il file sia immutato: un writer
    /// esterno può averlo cambiato senza un evento ancora consegnato. Il dedup
    /// evita uno snapshot aggiuntivo quando i byte coincidono con l'ultima
    /// versione. Una creazione non ha preimmagine; ogni altro errore ferma la
    /// scrittura prima che perda il contenuto precedente.
    ///
    /// Un file oltre [`MAX_VERSION_BYTES`] non ha versioni, e la scrittura
    /// passa senza fotografia, come a versioning spento. Il ripristino, che
    /// promette la fotografia di ciò che sostituisce, lì rifiuta da sé.
    pub fn photograph_before_write(
        &self,
        host: &mut dyn HostApi,
        id: &DocId,
    ) -> Result<(), PluginError> {
        if unread_over_the_cap(id, host)? {
            return Ok(());
        }
        match host.read_document_bytes(id) {
            Ok(source) => {
                self.store.snapshot(id, &source, host)?;
                Ok(())
            }
            // La nota non c'è: la scrittura è una creazione, e non c'è un
            // originale da salvare. `NotFound` è l'unico errore di lettura che
            // non è un guasto — ogni altro risale, e ferma la scrittura.
            Err(PluginError::NotFound(_)) => Ok(()),
            Err(and) => Err(and),
        }
    }

    /// Una nota che non c'è più: se l'ha presa il cestino, la sua storia le va
    /// dietro (vedi «Una nota cestinata non ha più il suo path» in testa).
    fn bury(&self, id: &DocId, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let Some(trashed) = self.trash_entry_of(id, host) else {
            return self.store.tombstone(id, host);
        };
        self.store.rename(id, &trashed, host)?;
        self.store.tombstone(&trashed, host)
    }

    /// La voce del cestino che ha appena preso `id`, se si riconosce.
    ///
    /// Il cestino può avere più voci con lo stesso path d'origine: serve quella
    /// **di adesso**, e le altre sono già state prese da chi le ha viste
    /// arrivare (la loro chiave sta nello store) oppure sono vecchie. Una
    /// cancellazione senza voce — il file è sparito da fuori, mentre nel cestino
    /// c'è una nota più vecchia che veniva dallo stesso path — non deve
    /// attribuire la storia di una nota alla voce di un'altra: per questo la voce
    /// dev'essere recente, e nessuno deve già averla presa.
    fn trash_entry_of(&self, id: &DocId, host: &dyn HostApi) -> Option<DocId> {
        let now = host.now_unix_millis() / 1_000;
        host.list_trash()
            .ok()?
            .into_iter()
            .filter(|entry| &entry.original == id)
            .filter(|entry| now.saturating_sub(entry.deleted_at) <= TRASH_RECENT_SECS)
            .filter(|entry| !self.store.holds(&entry.id))
            .max_by_key(|entry| entry.deleted_at)
            .map(|entry| entry.id)
    }

    /// Riconciliazione dopo un [`Event::Overflow`]: la coda è stata troncata e
    /// non si sa *cosa* si è perso, quindi si riparte dalla verità.
    ///
    /// Due passaggi, in quest'ordine:
    ///
    /// 1. **Tombstone** per ciò che lo store crede vivo e `list_documents` non
    ///    nomina più. Chiude il `DocumentRemoved` perso, che è il caso in cui il
    ///    versioning *mentirebbe* invece di limitarsi a saperne meno.
    /// 2. **Snapshot di tutto** ciò che esiste. Il dedup per contenuto (D6) rende
    ///    gratis gli immutati; per i cambiati nasce la versione che l'evento
    ///    perso non ha prodotto, e per un rename perso nasce la nuova storia sul
    ///    nuovo path (con la vecchia che resta leggibile sotto il suo tombstone).
    ///
    /// Non si prova a *indovinare* i rename: un contenuto identico su due path
    /// può essere un rename o una copia, e una storia unita per sbaglio sarebbe
    /// peggio di una spezzata per onestà.
    fn reconcile_after_overflow(&self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // **Vivo = esiste, non = è indicizzato**, e qui la differenza fa il
        // danno peggiore di tutto il file: un documento che esiste e che
        // l'indice non ha — uno scarto della 0068, o una nota che
        // l'indicizzazione non ha ancora raggiunto (§15.7) — riceverebbe un
        // **tombstone**, cioè il versioning dichiarerebbe morta una nota viva.
        // Chiedendolo all'anagrafe la domanda è quella che si intendeva fare.
        let live: std::collections::BTreeSet<String> = self
            .existing(host)?
            .into_iter()
            .map(|entry| entry.id.0)
            .collect();
        let mut sepolti = 0usize;
        for id in self.store.documents() {
            if live.contains(id.as_str()) || self.store.is_deleted(&id) {
                continue;
            }
            match self.store.tombstone(&id, host) {
                Ok(()) => sepolti += 1,
                Err(and) => {
                    tracing::warn!(target: "fub.versioning", "tombstone di {id} non scritto: {and}");
                    host.emit(Event::Trouble {
                        severity: Severity::Failure,
                        subject: Some(id.clone()),
                        error: and,
                        gate: None,
                    });
                }
            }
        }
        if sepolti > 0 {
            tracing::info!(
                target: "fub.versioning",
                "riconciliazione dopo un overflow, {sepolti} document{} \
                 risultat{} cancellat{}",
                if sepolti == 1 { "o" } else { "i" },
                if sepolti == 1 { "o" } else { "i" },
                if sepolti == 1 { "o" } else { "i" }
            );
        }
        self.sweep(host, Pass::All)
    }
}

/// Chi fotografare in una passata sull'intero vault.
enum Pass {
    /// Solo chi non ha ancora una storia: chi ce l'ha non paga nemmeno una
    /// lettura. Resta per chi riusa la passata a mano (i test). La
    /// riconciliazione dopo un `Overflow` passa da [`Passata::Tutti`].
    OnlyNew,
    /// Tutti (riconciliazione dopo un `Overflow`): il dedup per contenuto rende
    /// gratis gli immutati, e per gli altri nasce la versione persa.
    All,
}

impl EventHandler for VersioningHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::of([
            EventKind::DocumentChanged,
            EventKind::DocumentRenamed,
            EventKind::DocumentRemoved,
            EventKind::EntryChanged,
            EventKind::EntryRenamed,
            EventKind::EntryRemoved,
            // Senza questo, un troncamento della coda passerebbe inosservato e
            // il tombstone di una nota cancellata non arriverebbe mai.
            EventKind::Overflow,
        ])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        match &notice.event {
            Event::DocumentChanged { id, .. } => {
                let source = host.read_document_bytes(id)?;
                self.store.snapshot(id, &source, host)?;
            }
            Event::EntryChanged { id, kind } => {
                if over_the_cap(id, Some(*kind), host)? {
                    return Ok(());
                }
                let source = host.read_document_bytes(id)?;
                self.store.snapshot(id, &source, host)?;
            }
            Event::DocumentRenamed { from, to } | Event::EntryRenamed { from, to, .. } => {
                self.store.rename(from, to, host)?;
            }
            Event::DocumentRemoved { id } | Event::EntryRemoved { id, .. } => {
                self.bury(id, host)?;
            }
            Event::Overflow { .. } => self.reconcile_after_overflow(host)?,
            _ => {}
        }
        Ok(())
    }
}
