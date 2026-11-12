//! Come lo store scrive e rilegge il disco: il piano applicato, i lotti,
//! potatura, trasloco delle storie e ricostruzione dell'indice.

use super::*;

impl Inner {
    /// **Mette nel `meta.json` le impronte che l'indice ricorda** (FUB-004).
    ///
    /// Le storie scritte prima che il `meta.json` le registrasse non le hanno:
    /// se l'indice andasse perso, la ricostruzione le ricalcolerebbe dai byte e
    /// un blob alterato nel frattempo passerebbe per sano. Finché l'indice c'è,
    /// invece, le impronte che ricorda sono quelle della scrittura: questa è
    /// l'ultima occasione di salvarle, e si fa una volta sola (`registered`
    /// torna nell'indice e il prossimo `open` non guarda più).
    ///
    /// Una cartella che non si può leggere o scrivere non ferma le altre e non
    /// fa dichiarare la cosa finita: il prossimo `open` ci riprova. Una che non
    /// è di nessuno (senza `meta.json`, o di un altro documento) non c'entra.
    pub(super) fn register_fingerprints(&mut self, host: &mut dyn HostApi) {
        let mut complete = true;
        for (id, doc) in &self.docs {
            if let Err(error) = register_in_meta(id, doc, host) {
                complete = false;
                host.emit(Event::Trouble {
                    severity: Severity::Warning,
                    subject: Some(DocId::new(id)),
                    error,
                    gate: None,
                });
            }
        }
        if !complete {
            return;
        }
        self.registered = true;
        if let Err(error) = write_index(&self.docs, true, host) {
            host.emit(Event::Trouble {
                severity: Severity::Warning,
                subject: None,
                error,
                gate: None,
            });
        }
    }

    /// Dove sta il blob di **questa** versione, secondo l'anagrafe in memoria.
    ///
    /// Esiste per una ragione sola, ed è la stessa per cui [`Inner::apply`] è
    /// il posto unico in cui `docs` cambia: qui il prestito dello store finisce
    /// **prima** dell'I/O, e finisce per costruzione — chi legge il blob riceve
    /// il path e i metadati di verifica, non una guardia sullo store. La
    /// forma opposta — un `lock()` in testa a [`VersionStore::read`] e un
    /// `data_read` sotto — è quella che due lettori di cronologia si passavano
    /// uno alla volta, ognuno aspettando l'I/O dell'altro.
    ///
    /// Il verso opposto vale nelle **scritture**, e non è una svista: là il
    /// prestito attraversa il disco apposta, perché il piano si costruisce da ciò
    /// che c'è adesso e si installa solo se il disco l'ha accettato. Toglierlo di
    /// lì non toglierebbe un'attesa: aprirebbe una finestra in cui due
    /// salvataggi pianificano dalla stessa base e il secondo cancella il primo.
    pub(super) fn path(&self, id: &DocId, ts: u64) -> Result<(String, VersionRef), PluginError> {
        let doc = self.docs.get(id.as_str()).ok_or_else(|| {
            PluginError::BadArgs(Text::message(
                NO_VERSIONS,
                vec![Arg::text(DOC, id.as_str())],
            ))
        })?;
        let version = doc.versions.iter().find(|v| v.ts == ts).ok_or_else(|| {
            PluginError::BadArgs(Text::message(
                NO_SUCH_VERSION,
                vec![Arg::timestamp(WHEN, ts), Arg::text(DOC, id.as_str())],
            ))
        })?;
        Ok((blob(&doc.dir, &snapshot_name(ts, id.as_str())), *version))
    }

    /// La cartella del documento nello spazio dati del plugin.
    ///
    /// Il nome nasce dall'impronta del `doc_id`; se quella cartella è già di
    /// un altro documento — una collisione di impronte, improbabile ma non
    /// impossibile — si prende la successiva libera. Meglio un nome brutto che
    /// due storie mescolate.
    ///
    /// Non crea niente — né sul disco né in memoria: le directory intermedie
    /// nascono alla prima scrittura, uno store senza contenuti non deve
    /// lasciare cartelle vuote in giro, e il nome trovato entra nell'anagrafe
    /// solo passando per [`Inner::apply`]. Prenotarlo qui vorrebbe dire
    /// lasciare in memoria, dopo un salvataggio fallito, un documento che il
    /// disco non ha mai visto.
    pub(super) fn dir_for(&self, id: &DocId, host: &dyn HostApi) -> Result<String, PluginError> {
        if let Some(doc) = self.docs.get(id.as_str()) {
            if !doc.dir.is_empty() {
                return Ok(doc.dir.clone());
            }
        }
        let base = format!("{:016x}", fingerprint(id.as_str()));
        for n in 0u32.. {
            let name = if n == 0 {
                base.clone()
            } else {
                format!("{base}-{n}")
            };
            let is_free = match claim_of(&name, host)? {
                Claim::None => true,
                Claim::Owned(metadata) => metadata.doc_id == id.as_str(),
                // Un `meta.json` che non si legge **non** è una cartella
                // libera: è una cartella di cui non sappiamo il proprietario.
                // Darla via vorrebbe dire scriverci sopra il nome di questo
                // documento, e attribuirgli gli snapshot dell'altro alla prima
                // ricostruzione — cioè proprio le due storie mescolate che
                // questa funzione esiste per non fare. Il caso si raggiunge
                // senza bisogno di una collisione di impronte: dopo un rename
                // la chiave migra e la cartella resta col nome dell'impronta
                // vecchia, quindi il primo documento che rinasce con quel path
                // se la ritrova davanti. La direzione innocua è il nome brutto;
                // e la cartella non resta perduta per sempre, perché il
                // prossimo salvataggio del suo vero proprietario riscrive il
                // `meta.json` e la rende di nuovo leggibile.
                Claim::Unreadable => false,
            };
            if is_free {
                return Ok(name);
            }
        }
        unreachable!("la sequenza dei nomi è infinita")
    }

    /// Un istante non ancora usato da questo documento, e **mai prima**
    /// dell'ultimo: due salvataggi nello stesso millisecondo sono improbabili,
    /// ma sovrascriversi a vicenda no — e se l'orologio torna indietro fra due
    /// salvataggi (NTP, fuso, VM), `versions` deve restare ordinato per tempo:
    /// è dato persistito, e su di esso ragionano "attuale" in `list` e la
    /// protezione della più recente in [`prune`].
    pub(super) fn free_ts(&self, id: &DocId, host: &dyn HostApi) -> u64 {
        let ts = host.now_unix_millis();
        let minimum = self
            .docs
            .get(id.as_str())
            .and_then(|d| d.versions.iter().map(|v| v.ts).max())
            .map_or(0, |last| last + 1);
        ts.max(minimum)
    }

    /// Rende vero sul disco lo stato che i documenti **avranno**, e solo se il
    /// disco l'ha accettato lo installa in memoria.
    ///
    /// È il posto **unico** in cui `Inner::docs` cambia, ed è la ragione per
    /// cui [`Inner::dir_for`] e [`prune`] lavorano su un piano invece che sullo
    /// stato vivo: la mutazione qui è il *prodotto* della scrittura riuscita,
    /// non il suo presupposto. Nella forma opposta — muta, poi persisti col
    /// `?` — un disco che dice di no lascia la memoria avanti di un passo, e
    /// non c'è nessun ramo d'errore da ricordarsi di scrivere: chi aggiunge un
    /// campo a [`DocVersions`] eredita l'ordine giusto senza saperlo.
    ///
    /// Il `meta.json` va **prima** dell'indice perché l'autorità è il **disco**
    /// e l'indice ne è il derivato (vedi il preambolo del modulo, e
    /// [`VersionStore::open`], che dai meta ricostruisce). Vale per il
    /// `meta.json` quello che vale già per il blob di una versione, scritto
    /// anche lui prima di arrivare qui: se poi l'indice non passa, ciò che è
    /// finito sul disco è la verità, e resta lì ad aspettare la ricostruzione
    /// che la ritroverà.
    ///
    /// Quindi non è vero, e non deve esserlo, che «se il meta passa e l'indice
    /// no il disco resta com'era»: il disco è **avanti**, verso il vero, e
    /// l'indice e la memoria restano indietro insieme — indietro concordi, che
    /// è la proprietà che serve. L'ordine inverso invece lascerebbe l'indice
    /// avanti e il disco indietro, cioè un derivato che afferma una versione o
    /// un tombstone di cui la verità non sa niente.
    ///
    /// Ciò che questa forma **non** basta a garantire è che le rivendicazioni
    /// sul disco restino una per documento: quella la tiene [`relocate`],
    /// togliendo la rivendicazione vecchia prima che qui se ne scriva una nuova.
    pub(super) fn apply(
        &mut self,
        plan: Plan,
        metadata_doc: &DocId,
        host: &mut dyn HostApi,
    ) -> Result<(), PluginError> {
        if let Some(Entry::Present(doc)) = plan.get(metadata_doc.as_str()) {
            write_metadata(metadata_doc, doc, host)?;
        }
        // Dentro un lotto l'indice non si scrive: lo scrive
        // [`VersionStore::in_lotto`] una volta sola, in fondo. Il piano si
        // installa lo stesso, e non è un'eccezione alla regola di sopra — è la
        // stessa regola letta sull'autorità giusta. Ciò che il disco ha
        // accettato qui è il `meta.json`, e il `meta.json` è la verità;
        // l'indice ne è il derivato, e un derivato che manca non è una bugia,
        // è la condizione da cui [`VersionStore::open`] ricostruisce.
        if !self.batch {
            write_index(
                PlanDocs {
                    live: &self.docs,
                    plan: &plan,
                },
                self.registered,
                host,
            )?;
        }
        // E solo adesso il piano entra: una chiave per volta, non una mappa al
        // posto di un'altra. Ciò che il piano non nomina non è cambiato.
        for (key, entry) in plan {
            match entry {
                Entry::Present(doc) => {
                    self.docs.insert(key, doc);
                }
                Entry::Removed => {
                    self.docs.remove(&key);
                }
            }
        }
        Ok(())
    }
}

/// Il lotto aperto: finché vive, l'indice non si riscrive a ogni fotografia.
///
/// È un `Drop` e non due righe in fila perché il flag deve tornare giù anche se
/// la passata srotola: un lotto rimasto aperto sarebbe uno store che non scrive
/// più l'indice, mai più, e il difetto successivo sarebbe molto peggio di
/// quello riparato. Il `Drop` **non scrive** — chiudere il conto sul disco può
/// fallire, e un errore che scappasse da un `Drop` non avrebbe dove andare
/// (peggio: un panico da un `Drop` è un `abort`).
pub(super) struct Batch<'a> {
    pub(super) inner: &'a Mutex<Inner>,
}

impl Drop for Batch<'_> {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.batch = false;
        }
    }
}

/// Le versioni di `doc` che il `meta.json` della sua cartella non nomina
/// ancora, ci entrano con l'impronta che l'indice ricorda. Ciò che il
/// `meta.json` già dice non si tocca: l'autorità è lui.
fn register_in_meta(
    id: &str,
    doc: &DocVersions,
    host: &mut dyn HostApi,
) -> Result<(), PluginError> {
    let Claim::Owned(mut metadata) = claim_of(&doc.dir, host)? else {
        return Ok(());
    };
    if metadata.doc_id != id {
        return Ok(());
    }
    let known: std::collections::BTreeSet<u64> = metadata.versions.iter().map(|v| v.ts).collect();
    let missing: Vec<VersionRef> = doc
        .versions
        .iter()
        .filter(|version| !known.contains(&version.ts))
        .copied()
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    metadata.versions.extend(missing);
    metadata.versions.sort_by_key(|version| version.ts);
    let raw = serde_json::to_vec(&metadata).map_err(|and| {
        PluginError::Internal(Text::message(
            METADATA_UNWRITABLE,
            vec![Arg::text(REASON, and.to_string())],
        ))
    })?;
    host.data_write(&blob(&doc.dir, METADATA_FILE), &raw)
}

fn write_metadata(
    id: &DocId,
    doc: &DocVersions,
    host: &mut dyn HostApi,
) -> Result<(), PluginError> {
    let metadata = Meta {
        doc_id: id.to_string(),
        deleted_at: doc.deleted_at,
        versions: doc.versions.clone(),
    };
    let raw = serde_json::to_vec(&metadata).map_err(|and| {
        PluginError::Internal(Text::message(
            METADATA_UNWRITABLE,
            vec![Arg::text(REASON, and.to_string())],
        ))
    })?;
    host.data_write(&blob(&doc.dir, METADATA_FILE), &raw)
}

pub(super) fn write_index(
    docs: impl Serialize,
    registered: bool,
    host: &mut dyn HostApi,
) -> Result<(), PluginError> {
    let index = IndexToWrite {
        schema_version: SCHEMA_VERSION,
        registered,
        docs,
    };
    let raw = serde_json::to_vec(&index).map_err(|and| {
        PluginError::Internal(Text::message(
            INDEX_UNWRITABLE,
            vec![Arg::text(REASON, and.to_string())],
        ))
    })?;
    host.data_write(INDEX_FILE, &raw)
}

/// Applica le fasce di ritenzione (D6) all'elenco **del piano** e
/// **restituisce i contenuti che avanzano**, senza cancellarne nessuno.
///
/// Non cancella perché non può saperlo: finché l'indice potato non è sul disco,
/// i blob che qui risultano di troppo sono ancora nominati dall'indice che c'è,
/// e toglierli lo renderebbe bugiardo. Li spazza chi chiama, dopo
/// [`Inner::apply`], con [`sweep`]. La direzione innocua dell'errore è il
/// blob orfano — costa spazio; quella rovinosa è l'indice che nomina un
/// contenuto sparito, che rompe ogni [`VersionStore::read`].
///
/// Pota il **piano** e non lo stato vivo per la stessa ragione: assottigliare
/// l'elenco in memoria e poi non riuscire a scrivere l'indice toglierebbe da
/// sotto gli occhi versioni che sul disco ci sono ancora.
#[must_use = "sono i contenuti da spazzare dopo aver scritto l'indice"]
pub(super) fn prune(doc: &mut DocVersions, id: &DocId, host: &dyn HostApi) -> Vec<String> {
    let now = host.now_unix_millis();
    let policy = Retention::read(host);
    let mut kept: Vec<VersionRef> = Vec::with_capacity(doc.versions.len());
    let mut fasce_seen: Vec<(u8, u64)> = Vec::new();
    // Dalla più recente: dentro ogni fascia vince la più recente.
    for (the, v) in doc.versions.iter().rev().enumerate() {
        let eta = now.saturating_sub(v.ts);
        // La più recente non si pota mai: è la versione che rappresenta lo
        // stato attuale della nota, anche se la nota è ferma da un anno.
        let key = if the == 0 {
            None
        } else if policy.horizon.is_some_and(|horizon| eta >= horizon) {
            continue; // oltre l'orizzonte: non si conserva
        } else if eta < BAND_ALL {
            (policy.interval > 0).then(|| (0, v.ts / policy.interval))
        } else if eta < BAND_HOURLY {
            Some((1, v.ts / MS_HOUR))
        } else {
            Some((2, v.ts / MS_DAY))
        };
        if let Some(key) = key {
            if fasce_seen.contains(&key) {
                continue;
            }
            fasce_seen.push(key);
        }
        kept.push(*v);
    }
    kept.reverse();
    if kept.len() == doc.versions.len() {
        return Vec::new();
    }

    let kept_timestamps: HashSet<u64> = kept.iter().map(|t| t.ts).collect();
    let advanced: Vec<String> = doc
        .versions
        .iter()
        .filter(|v| !kept_timestamps.contains(&v.ts))
        .map(|v| blob(&doc.dir, &snapshot_name(v.ts, id.as_str())))
        .collect();
    doc.versions = kept;
    advanced
}

/// Toglie dallo store contenuti che l'indice **già scritto** non nomina più.
///
/// È il posto unico in cui il versioning cancella un blob, e non rende un
/// errore di proposito: qui si arriva solo a indice persistito, e a quel punto
/// un contenuto che non se ne va è spazio sprecato — non una bugia. Chiamarla
/// prima di [`Inner::apply`] è l'inversione che rompe tutto, ed è la
/// ragione per cui [`prune`] restituisce path invece di cancellarli.
pub(super) fn sweep(paths: &[String], host: &mut dyn HostApi) {
    for path in paths {
        if let Err(and) = host.data_remove(path) {
            tracing::warn!(target: "fub.versioning", "{path} è rimasto indietro e non se ne va: {and}");
        }
    }
}

/// L'esito di un trasloco: la storia unita, e i blob rimasti indietro.
pub(super) struct Relocation {
    pub(super) doc: DocVersions,
    pub(super) to_remove: Vec<String>,
}

/// Unisce due storie sullo stesso path, in ordine di tempo, e porta i contenuti
/// dove il nuovo path li farà cercare.
///
/// Un blob non sta dove il suo `ts` dice, ma dove lo mettono **la cartella del
/// documento e l'estensione del suo path** (vedi [`blob`] e [`snapshot_name`]):
/// tenere l'indice di due storie e la cartella di una sola era il modo di
/// scrivere nell'indice versioni il cui contenuto non è mai stato lì.
///
/// Prima si **copia**, poi chi chiama scrive l'indice, e solo alla fine si
/// cancella ciò che è rimasto indietro. L'ordine inverso lascerebbe, al primo
/// errore, un indice che nomina contenuti spariti — cioè il modo in cui il
/// versioning fallisce senza sembrare rotto.
///
/// # Le copie non scrivono mai su un contenuto che l'indice nomina
///
/// Copiare prima non basta, se una copia atterra su un blob che l'indice di
/// prima nomina ancora: una fotografia slittata da T a T+1 finiva sul blob
/// T+1 della storia che arriva, e se una copia successiva falliva il rename si
/// fermava con l'indice di prima a nominare un contenuto ormai riscritto
/// (AUDIT-DATI-06). Le copie si pianificano quindi tutte **prima** di toccare
/// il disco; se anche una sola atterrerebbe su un contenuto nominato, la
/// storia unita va in una cartella nuova ([`fresh_dir`]), dove nessun nome è
/// di nessuno. L'indice nuovo è la pubblicazione: fino a lì le copie stanno
/// sotto nomi che l'indice di prima non conosce, e se una fallisce quelle già
/// scritte si tolgono.
pub(super) fn relocate(
    doc: &DocVersions,
    from: &DocId,
    existing: Option<&DocVersions>,
    to: &DocId,
    host: &mut dyn HostApi,
) -> Result<Relocation, PluginError> {
    // Dove sta ogni contenuto adesso: la storia che arriva è ancora sotto la
    // sua cartella e col nome che le dava il path vecchio, quella che c'era già
    // sta sotto una cartella tutta sua.
    let mut candidate: Vec<(String, VersionRef)> = doc
        .versions
        .iter()
        .map(|v| (blob(&doc.dir, &snapshot_name(v.ts, from.as_str())), *v))
        .collect();
    if let Some(existing) = existing {
        candidate.extend(
            existing
                .versions
                .iter()
                .map(|v| (blob(&existing.dir, &snapshot_name(v.ts, to.as_str())), *v)),
        );
    }
    // Ordinamento stabile: a parità di istante la storia che arriva viene
    // prima, ed è quella che si tiene il suo `ts`.
    candidate.sort_by_key(|(_, v)| v.ts);
    let indexed: HashSet<String> = candidate.iter().map(|(origin, _)| origin.clone()).collect();

    // La storia unita, decisa senza toccare il disco: chi resta, con quale `ts`.
    let mut merged: Vec<(String, VersionRef)> = Vec::with_capacity(candidate.len());
    let mut to_remove: Vec<String> = Vec::new();
    for (origin, mut v) in candidate {
        match merged.last() {
            // Stesso istante e stesso contenuto: è la stessa fotografia
            // arrivata da due storie, non due versioni.
            Some((_, u)) if u.ts == v.ts && u.hash == v.hash => {
                to_remove.push(origin);
                continue;
            }
            // Stesso istante ma contenuti diversi: sono due fotografie davvero
            // distinte, e `ts` è l'identità di una versione. Slitta di un
            // millisecondo — sparire in silenzio è ciò che non deve fare.
            Some((_, u)) if v.ts <= u.ts => v.ts = u.ts + 1,
            _ => {}
        }
        merged.push((origin, v));
    }

    // La cartella che sopravvive è quella della storia che arriva. Una sola
    // cartella per documento non è un vezzo: `rebuild_from_store` si fida di
    // `meta.json`, e due cartelle che dichiarano lo stesso `doc_id` si
    // sovrascriverebbero a vicenda, con una delle due storie persa in silenzio.
    let preferred = match (doc.dir.is_empty(), existing) {
        (true, Some(existing)) => existing.dir.clone(),
        _ => doc.dir.clone(),
    };
    let lands_on_indexed = merged.iter().any(|(origin, v)| {
        let destination = blob(&preferred, &snapshot_name(v.ts, to.as_str()));
        destination != *origin && indexed.contains(&destination)
    });
    let dir = if lands_on_indexed {
        fresh_dir(to, host)?
    } else {
        preferred
    };

    let mut versions: Vec<VersionRef> = Vec::with_capacity(merged.len());
    let mut destinations: Vec<String> = Vec::with_capacity(merged.len());
    let mut copies: Vec<(usize, Vec<u8>)> = Vec::new();
    for (origin, v) in merged {
        let destination = blob(&dir, &snapshot_name(v.ts, to.as_str()));
        let copy = if destination != origin {
            let Some(bytes) = host.data_read(&origin)? else {
                // L'indice nominava un contenuto che non c'è più: non lo si
                // porta dietro, o continuerebbe a mentire sotto la chiave nuova.
                tracing::warn!(
                    target: "fub.versioning",
                    "{origin} non c'è più, la versione {} esce dalla storia di {to}",
                    v.ts
                );
                continue;
            };
            to_remove.push(origin);
            Some(bytes)
        } else {
            None
        };
        destinations.push(destination);
        versions.push(v);
        if let Some(bytes) = copy {
            copies.push((destinations.len() - 1, bytes));
        }
    }

    // Soltanto adesso, a letture finite e su nomi che l'indice di prima non
    // nomina, i blob si scrivono.
    let mut written: Vec<String> = Vec::with_capacity(copies.len());
    for (index, bytes) in &copies {
        let destination = &destinations[*index];
        if let Err(and) = host.data_write(destination, bytes) {
            // Ciò che si è già scritto non è di nessuno: l'indice di prima non
            // lo nomina e quello nuovo non ci sarà.
            sweep(&written, host);
            return Err(and);
        }
        written.push(destination.clone());
    }

    // La cartella abbandonata smette di dire di chi è **qui**, prima che
    // `apply` scriva la rivendicazione nuova — e non dopo, con gli altri
    // avanzi.
    //
    // La regola «prima l'indice, poi si cancella» vale per i **contenuti**, che
    // l'indice nomina: toglierne uno che l'indice nomina ancora è il modo di
    // rompere ogni `read`. Un `meta.json` l'indice non lo nomina, e rimandarlo
    // apriva la sola finestra in cui **due** cartelle rivendicano lo stesso
    // `doc_id`: se `scrivi_index` falliva lì in mezzo, il disco restava con la
    // cartella unita e quella vecchia che dicevano tutte e due `to`, e
    // `rebuild_from_store` — che le tiene in un `BTreeMap` per `doc_id` — ne
    // buttava una in silenzio, senza nessuna regola su quale.
    //
    // Qui invece si arriva a copie **tutte** fatte, ed è la precondizione che
    // rende questa cancellazione innocua: ciò che stava di là sta già di qua.
    // La finestra peggiore che resta è la cartella unita che dice ancora `from`,
    // cioè la storia intera sotto la chiave di prima — un nome vecchio, non una
    // storia persa. E se è la cancellazione stessa a non riuscire, il `?` ferma
    // il rename prima che la seconda rivendicazione esista.
    if let Some(existing) = existing {
        if existing.dir != dir {
            host.data_remove(&blob(&existing.dir, METADATA_FILE))?;
        }
    }
    // Una cartella nuova lascia indietro anche quella della storia che
    // arriva: la sua rivendicazione di `from` se ne va con gli avanzi, dopo
    // l'indice.
    if !doc.dir.is_empty() && doc.dir != dir {
        to_remove.push(blob(&doc.dir, METADATA_FILE));
    }
    // Un contenuto che serve ancora non si cancella, per quanto il suo vecchio
    // nome sia finito nella lista.
    to_remove.retain(|p| !destinations.contains(p));

    Ok(Relocation {
        doc: DocVersions {
            dir,
            // Il documento è vivo: è appena arrivato qui con un rename.
            deleted_at: None,
            versions,
        },
        to_remove,
    })
}

/// Una cartella dello store in cui non c'è niente e che nessuno rivendica,
/// nella famiglia dell'impronta di `id`.
///
/// È la stessa famiglia di [`Inner::dir_for`], ma chiede di più: non basta che
/// nessuno la rivendichi, dev'essere **vuota**, perché ci si scrivono copie
/// che non devono atterrare su niente.
pub(super) fn fresh_dir(id: &DocId, host: &dyn HostApi) -> Result<String, PluginError> {
    let base = format!("{:016x}", fingerprint(id.as_str()));
    for n in 1u32.. {
        let name = format!("{base}-{n}");
        if matches!(claim_of(&name, host)?, Claim::None) && host.data_list(&name)?.is_empty() {
            return Ok(name);
        }
    }
    unreachable!("la sequenza dei nomi è infinita")
}

/// Il nome di un blob dello store: i path dell'`HostApi` sono relativi allo
/// spazio del plugin e usano sempre `/`.
pub(super) fn blob(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

pub(super) fn snapshot_name(ts: u64, doc_id: &str) -> String {
    match doc_id.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() && !ext.contains('/') => format!("{ts}.{ext}"),
        _ => ts.to_string(),
    }
}

/// L'indice nello store, se c'è ed è della nostra epoca.
/// Prende un `&dyn ReadApi` e non un `&dyn HostApi`: leggere l'indice è una
/// lettura, e da quando il pannello cronologia lo rilegge dal percorso di
/// render — dove di scritture non ce ne sono — il tipo lo dice.
pub(super) fn load_index(host: &dyn ReadApi) -> Option<Index> {
    let raw = host.data_read(INDEX_FILE).ok()??;
    let index: Index = serde_json::from_slice(&raw).ok()?;
    (index.schema_version == SCHEMA_VERSION).then_some(index)
}

pub(super) fn read_index(host: &dyn ReadApi) -> Result<BTreeMap<String, DocVersions>, PluginError> {
    match load_index(host) {
        Some(index) => Ok(index.docs),
        None => rebuild_from_store(host),
    }
}

fn claim_of(dir: &str, host: &dyn ReadApi) -> Result<Claim, PluginError> {
    let Some(raw) = host.data_read(&blob(dir, METADATA_FILE))? else {
        return Ok(Claim::None);
    };
    Ok(match serde_json::from_slice(&raw) {
        Ok(metadata) => Claim::Owned(metadata),
        Err(_) => Claim::Unreadable,
    })
}

/// Ricostruisce l'indice leggendo lo store: ogni cartella dice di chi è
/// (`meta.json`), ogni file dice quando (il nome) e cosa (il contenuto).
///
/// È la direzione lecita del dubbio. Costa una lettura di tutti gli snapshot,
/// ma succede solo quando l'indice è perso — e un indice perso, senza questo,
/// renderebbe le versioni irraggiungibili per sempre.
///
/// [`VersionRef::hash`] è l'impronta FNV-1a **del contenuto** e `size` è la sua
/// lunghezza. Il `meta.json` di ogni cartella le registra quando la versione
/// nasce, e la ricostruzione le prende da lì senza aprire gli snapshot: così un
/// blob alterato dopo la scrittura resta alterato per `read_snapshot`, invece di
/// diventare "sano" perché gli si è ricalcolata l'impronta. Solo per le versioni
/// che il `meta.json` non nomina (cartelle di prima, scrittura interrotta) lo
/// snapshot si apre e l'impronta si ricalcola. I conti — una lettura per
/// documento con le impronte registrate, due senza — stanno in
/// `fub-features/tests/who_answers_opens_the_bytes.rs`.
pub(super) fn rebuild_from_store(
    host: &dyn ReadApi,
) -> Result<BTreeMap<String, DocVersions>, PluginError> {
    // I blob sono ordinati, quindi quelli di una stessa cartella sono contigui.
    let mut for_dir: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let blobs = host.data_list("")?;
    for path in &blobs {
        // Solo il primo livello: la struttura dello store è `<dir>/<file>`, e
        // ciò che sta alla radice (l'indice) non è uno snapshot.
        if let Some((dir, name)) = path.split_once('/') {
            if !name.contains('/') {
                for_dir.entry(dir).or_default().push(name);
            }
        }
    }

    let mut docs = BTreeMap::new();
    for (dir, names) in for_dir {
        let metadata = match claim_of(dir, host)? {
            Claim::Owned(metadata) => metadata,
            Claim::None => {
                tracing::warn!(target: "fub.versioning", "{dir} non dice di chi è, la salto");
                continue;
            }
            // Diverso dal caso sopra, e vale la pena dirlo: qui una storia c'è
            // e resta sul disco, fuori dall'indice finché quel `meta.json` non
            // torna leggibile. Nessun altro se la prende — [`Inner::dir_per`]
            // non dà via una cartella che non sa leggere — e il primo
            // salvataggio del suo proprietario la riscrive.
            Claim::Unreadable => {
                tracing::warn!(
                    target: "fub.versioning",
                    "il meta.json di {dir} non si legge: la sua storia resta sul \
                     disco ma fuori dall'indice"
                );
                continue;
            }
        };
        let registered: BTreeMap<u64, VersionRef> =
            metadata.versions.iter().map(|v| (v.ts, *v)).collect();
        let mut versions = Vec::new();
        for name in names {
            let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
            let Ok(ts) = stem.parse::<u64>() else {
                continue; // meta.json e tutto ciò che non è uno snapshot
            };
            // Un'impronta registrata dalla scrittura vale più di una
            // calcolata adesso: se il blob è stato alterato nel frattempo,
            // `read_snapshot` lo vedrà. Il blob nemmeno si apre — l'elenco
            // dello store dice già che c'è.
            if let Some(version) = registered.get(&ts) {
                versions.push(*version);
                continue;
            }
            // Una versione che `meta.json` non nomina: o la cartella è di
            // prima delle impronte registrate, o la scrittura si è interrotta
            // fra il blob e il `meta.json`. Si ricalcola dai byte, e non si
            // può fare di meglio.
            let Some(bytes) = host.data_read(&blob(dir, name))? else {
                continue;
            };
            versions.push(VersionRef {
                ts,
                hash: Fnv1a::hash(&bytes),
                size: bytes.len() as u64,
            });
        }
        versions.sort_by_key(|v| v.ts);
        docs.insert(
            metadata.doc_id,
            DocVersions {
                dir: dir.to_string(),
                deleted_at: metadata.deleted_at,
                versions,
            },
        );
    }
    Ok(docs)
}

/// Se l'anagrafe sa già che `id` supera [`MAX_VERSION_BYTES`]: allora non lo
/// si apre nemmeno. Un file che l'anagrafe non nomina si legge, e sui byte
/// decide [`VersionStore::snapshot`].
///
/// La domanda è la cartella di `id`, e con `kind` soltanto i suoi simili: la
/// risposta cresce con loro, non col vault.
pub(super) fn over_the_cap(
    id: &DocId,
    kind: Option<EntryKind>,
    host: &(impl HostQuery + ?Sized),
) -> Result<bool, PluginError> {
    let folder = id
        .as_str()
        .rsplit_once('/')
        .map_or("", |(folder, _)| folder);
    Ok(entries(host, kind, Some(FolderScope::direct(folder)))?
        .iter()
        .any(|entry| entry.id == *id && entry.size > MAX_VERSION_BYTES))
}

/// Il tetto, chiesto prima di leggere, per ciò che il kernel non legge da sé.
///
/// Un documento il kernel lo legge e lo parsa a ogni modifica: rileggerlo
/// costa quanto quel lavoro, e i suoi byte oltre il tetto li ferma
/// [`VersionStore::snapshot`]. Chiederlo a ogni salvataggio sarebbe invece un
/// giro della cartella per nota, e una rinomina che ne riscrive mille lo
/// pagherebbe mille volte. Un allegato non lo apre nessuno: leggerlo intero per
/// scoprire che è troppo grande era proprio il difetto.
pub(super) fn unread_over_the_cap(
    id: &DocId,
    host: &(impl VaultRead + HostQuery + ?Sized),
) -> Result<bool, PluginError> {
    match media::kind_of_ext(id, |_| host.format_of(id).is_some()) {
        EntryKind::Document => Ok(false),
        kind => over_the_cap(id, Some(kind), host),
    }
}

/// Le voci dell'anagrafe in `within`, o del vault intero.
pub(super) fn entries(
    host: &(impl HostQuery + ?Sized),
    of_kind: Option<EntryKind>,
    within: Option<FolderScope>,
) -> Result<Vec<VaultEntry>, PluginError> {
    match host.query_index(IndexQuery::Entries {
        of_kind,
        within,
        page: None,
    })? {
        IndexResult::Entries(paged) => Ok(paged.items),
        other => Err(PluginError::Internal(
            format!("l'anagrafe ha risposto con {other:?}").into(),
        )),
    }
}

/// Il tetto in MiB, per i messaggi.
pub(super) fn cap_in_mib() -> Arg {
    Arg::int(LIMIT, (MAX_VERSION_BYTES >> 20) as i64)
}

/// La stessa impronta stabile fra versioni di Rust e piattaforme che usa
/// l'indice di ricerca — questi valori sopravvivono su disco. Il commento lo
/// dichiarava già da prima che fosse vero: adesso è la [`Fnv1a`] del contratto,
/// non una terza copia delle stesse due costanti.
fn fingerprint(source: &str) -> u64 {
    Fnv1a::hash(source.as_bytes())
}
