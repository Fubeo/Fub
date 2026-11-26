//! Organizzazione, manutenzione, ricongiungimento delle rinomine e dati dei plugin.

use super::*;

/// **Le rinomine fatte ad app chiusa**, riconosciute alla fine di
/// un'indicizzazione, con i dati per-documento da portare dietro **fuori** dal
/// prestito esclusivo ([`Workspace::finalize_finish_index_detached`]).
///
/// Spostare l'organizzazione, lo stato per-documento e le bozze è scrivere sul
/// disco, una volta per ogni rinomina: dopo una riorganizzazione fatta con un
/// altro programma sono decine di scritture, e dentro il prestito ognuna
/// fermava le letture del vault (IMP-1805). Va eseguita sotto lo stesso turno
/// di scrittura della chiusura, e prima della raccolta degli spazi orfani
/// (`collect_doc_data`): prima si riconosce, poi si raccoglie.
#[must_use = "i dati delle rinomine vanno spostati con `invoke` e poi detti con `finish_rejoin`"]
pub struct PendingRejoin {
    pub(super) pairs: Vec<(DocId, DocId)>,
    pub(super) organization: Arc<OrganizationStore>,
    pub(super) drafts: Arc<Drafts>,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) doc_data_roots: Vec<Utf8PathBuf>,
}

/// Le rinomine di un [`PendingRejoin`] con i dati già spostati: restano da
/// dire ([`Workspace::finish_rejoin`]).
#[must_use = "le rinomine vanno dette con `finish_rejoin`"]
pub struct CompletedRejoin {
    pub(super) pairs: Vec<(DocId, DocId)>,
    pub(super) doc_data_warnings: Vec<String>,
}

impl PendingRejoin {
    /// Nessuna rinomina da portare dietro.
    pub fn is_empty(&self) -> bool {
        self.pairs.is_empty()
    }

    /// Sposta i dati di ogni rinomina, senza prestito del workspace: gli
    /// stessi tre canali, con gli stessi avvisi, di
    /// [`Workspace::migrate_side_data`].
    pub fn invoke(self) -> CompletedRejoin {
        let PendingRejoin {
            pairs,
            organization,
            drafts,
            storage,
            doc_data_roots,
        } = self;
        let mut doc_data_warnings = Vec::new();
        for (from, to) in &pairs {
            migrate_side_data_on(
                &organization,
                &drafts,
                storage.as_ref(),
                &doc_data_roots,
                from,
                to,
                &mut doc_data_warnings,
            );
        }
        CompletedRejoin {
            pairs,
            doc_data_warnings,
        }
    }
}

/// Il corpo di [`Workspace::migrate_side_data`] sugli handle posseduti: lo
/// usano la via con il workspace in mano e [`PendingRejoin::invoke`], così i
/// canali che seguono una rinomina restano scritti in un posto solo.
pub(super) fn migrate_side_data_on(
    organization: &OrganizationStore,
    drafts: &Drafts,
    storage: &dyn crate::storage::VaultStorage,
    doc_data_roots: &[Utf8PathBuf],
    from: &DocId,
    to: &DocId,
    doc_data_warnings: &mut Vec<String>,
) {
    if let Err(and) = organization.migrate(from.as_str(), to.as_str()) {
        organization.warn(format!(
            "l'organizzazione di {from} non ha potuto seguire la rinomina in \
             {to}: {and}"
        ));
    }
    for error in crate::docdata::migrate_data(storage, doc_data_roots, from, to) {
        doc_data_warnings.push(format!(
            "lo stato per-documento di {from} non ha potuto seguire la rinomina \
             in {to} — {error}"
        ));
    }
    if let Err(and) = drafts.migrate(from, to) {
        organization.warn(format!(
            "la bozza non salvata di {from} non ha potuto seguire la \
             rinomina in {to}: {and}"
        ));
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub(super) struct StoredCivilTime {
    pub(super) year: i32,
    pub(super) month: u8,
    pub(super) day: u8,
    pub(super) hour: u8,
    pub(super) minute: u8,
    pub(super) second: u8,
}

impl From<StoredCivilTime> for CivilTime {
    fn from(value: StoredCivilTime) -> Self {
        CivilTime {
            year: value.year,
            month: value.month,
            day: value.day,
            hour: value.hour,
            minute: value.minute,
            second: value.second,
        }
    }
}

impl From<CivilTime> for StoredCivilTime {
    fn from(value: CivilTime) -> Self {
        StoredCivilTime {
            year: value.year,
            month: value.month,
            day: value.day,
            hour: value.hour,
            minute: value.minute,
            second: value.second,
        }
    }
}

/// Token owned per the persistent timer-cursor file.
///
/// The workspace validates the plugin namespace and freezes both the storage
/// handle and the absolute path. Invoking the token can therefore perform
/// storage I/O after the `Workspace` guard has been released.
pub struct PreparedTimerCursors {
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) path: Utf8PathBuf,
}

impl PreparedTimerCursors {
    /// Read all persisted cursors for this plugin.
    pub fn read(self) -> std::result::Result<BTreeMap<String, CivilTime>, PluginError> {
        let bytes = match self.storage.read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(PluginError::Io(format!("{}: {error}", self.path).into())),
        };
        let stored: BTreeMap<String, StoredCivilTime> =
            serde_json::from_slice(&bytes).map_err(|error| {
                PluginError::Internal(format!("timer cursors at {}: {error}", self.path).into())
            })?;
        Ok(stored
            .into_iter()
            .map(|(id, time)| (id, time.into()))
            .collect())
    }

    /// Atomically advance one persisted cursor without accepting stale updates.
    pub fn write(self, timer: &str, cursor: CivilTime) -> std::result::Result<(), PluginError> {
        let path = self.path;
        self.storage
            .update(&path, &mut |existing| {
                let mut stored: BTreeMap<String, StoredCivilTime> = existing
                    .map(serde_json::from_slice)
                    .transpose()
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?
                    .unwrap_or_default();
                if stored
                    .get(timer)
                    .is_some_and(|current| cursor <= CivilTime::from(*current))
                {
                    return Ok(None);
                }
                stored.insert(timer.to_owned(), cursor.into());
                serde_json::to_vec_pretty(&stored)
                    .map(Some)
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
            })
            .map_err(|error| PluginError::Io(format!("{path}: {error}").into()))
    }
}

pub(super) const TIMER_CURSORS_FILE: &str = "timers.json";

/// Marca `.fub/data/plugins/<id>/` come cache. Senza di esso quella cartella
/// è l'albero autorevole *legacy*: `cache_write` la crea, e data_* non deve
/// scambiarla per dati.
pub(crate) const PLUGIN_CACHE_MARK: &str = ".fub-cache-root";

/// Token owned per l'I/O dello spazio dati di un plugin.
///
/// Il workspace valida e congela radici e path; ogni domanda al supporto,
/// inclusa la scelta fra namespace canonico e legacy e il marcatore cache,
/// avviene soltanto quando il token viene invocato.
pub struct PreparedPluginDataIo {
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) canonical_root: Utf8PathBuf,
    pub(super) cache_root: Utf8PathBuf,
    pub(super) cache_mark: Utf8PathBuf,
    pub(super) canonical_path: Utf8PathBuf,
    pub(super) cache_path: Utf8PathBuf,
}

/// La domanda «c'è?» che sceglie fra dati autorevoli e cache di un plugin:
/// soltanto un «non c'è» del supporto vale «no». Una `stat` fallita letta come
/// assenza sceglieva la radice sbagliata — la lettura rispondeva «mai
/// scritto», e una scrittura di cache posava il marcatore dentro i dati
/// vecchi, che da lì in poi nessuno leggeva più.
pub(super) fn plugin_root_present(
    storage: &dyn crate::storage::VaultStorage,
    path: &Utf8Path,
) -> std::result::Result<bool, PluginError> {
    crate::error::optional(storage.stat(path))
        .map(|stat| stat.is_some())
        .map_err(|source| {
            PluginError::from(KernelError::Io {
                path: path.to_owned(),
                source,
            })
        })
}

/// Rende `cache_root` una radice di cache: prima porta in `canonical_root` ciò
/// che vi sta ancora come dato autorevole *legacy*, poi posa il marcatore.
///
/// Il marcatore riclassifica **tutto** l'albero: da lì la radice è derivata,
/// gli snapshot la escludono e un ripristino la toglie. Posarlo su dati legacy
/// non migrati li consegnava a quella sorte, ed è ciò che il percorso staccato
/// faceva quando la radice canonica esisteva già: la migrazione la saltava,
/// perché la scelta della radice autorevole diceva «canonica», e il marcatore
/// finiva sui dati vecchi. Una sola funzione per il percorso diretto e per
/// quello staccato è ciò che impedisce alle due strade di divergere di nuovo.
pub(super) fn claim_plugin_cache_root(
    storage: &dyn crate::storage::VaultStorage,
    canonical_root: &Utf8Path,
    cache_root: &Utf8Path,
    cache_mark: &Utf8Path,
) -> std::result::Result<(), PluginError> {
    if plugin_root_present(storage, cache_root)? && !plugin_root_present(storage, cache_mark)? {
        migrate_legacy_plugin_root(storage, cache_root, canonical_root).map_err(|error| {
            PluginError::Io(
                format!("migrazione `{cache_root}` → `{canonical_root}`: {error}").into(),
            )
        })?;
    }
    storage
        .write_derived(cache_mark, b"cache\n")
        .map(|_| ())
        .map_err(|error| PluginError::Io(format!("{cache_mark}: {error}").into()))
}

/// Porta l'albero legacy dentro la radice canonica senza sovrascrivere niente.
///
/// Senza radice canonica è una mossa sola. Con la radice canonica già lì le
/// voci si portano una per una, con `rename_no_replace`, e una cartella che
/// esiste da tutte e due le parti si attraversa. Un nome preso da tutte e due
/// le parti non si sceglie: sono due dati autorevoli, e nessuno dei due è da
/// buttare. La migrazione allora fallisce, l'albero legacy resta autorevole
/// con ciò che non ha potuto lasciare, e la cache non si scrive finché
/// qualcuno non decide.
pub(super) fn migrate_legacy_plugin_root(
    storage: &dyn crate::storage::VaultStorage,
    legacy: &Utf8Path,
    canonical: &Utf8Path,
) -> std::io::Result<()> {
    if crate::error::optional(storage.stat(canonical))?.is_none() {
        return storage.rename_no_replace(legacy, canonical);
    }
    let mut taken = Vec::new();
    merge_legacy_plugin_tree(storage, legacy, canonical, &mut taken)?;
    match taken.first() {
        None => Ok(()),
        Some(first) => Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!(
                "{first} exists in both roots ({} names in all): the legacy data stays where it is",
                taken.len()
            ),
        )),
    }
}

/// Un livello della fusione di [`migrate_legacy_plugin_root`]: raccoglie in
/// `taken` le voci legacy il cui nome la radice canonica ha già.
///
/// I compagni di lock e i temporanei di scrittura sono del supporto, non del
/// plugin: non si spostano e non contano come collisione.
pub(super) fn merge_legacy_plugin_tree(
    storage: &dyn crate::storage::VaultStorage,
    legacy: &Utf8Path,
    canonical: &Utf8Path,
    taken: &mut Vec<Utf8PathBuf>,
) -> std::io::Result<()> {
    for entry in storage.list(legacy)? {
        let Some(name) = entry.path.file_name() else {
            continue;
        };
        if crate::storage::is_write_lock(name) || crate::storage::is_write_temporary(name) {
            continue;
        }
        let target = canonical.join(name);
        match crate::error::optional(storage.stat(&target))? {
            None => match storage.rename_no_replace(&entry.path, &target) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    taken.push(entry.path);
                }
                Err(error) => return Err(error),
            },
            Some(stat) if stat.is_dir() && entry.stat.is_dir() => {
                merge_legacy_plugin_tree(storage, &entry.path, &target, taken)?;
            }
            Some(_) => taken.push(entry.path),
        }
    }
    Ok(())
}

impl PreparedPluginDataIo {
    pub(super) fn authoritative_uses_canonical(&self) -> std::result::Result<bool, PluginError> {
        let present = |path| plugin_root_present(self.storage.as_ref(), path);
        Ok(present(&self.canonical_root)?
            || !present(&self.cache_root)?
            || present(&self.cache_mark)?)
    }

    pub(super) fn authoritative_path(&self) -> std::result::Result<&Utf8Path, PluginError> {
        Ok(if self.authoritative_uses_canonical()? {
            &self.canonical_path
        } else {
            &self.cache_path
        })
    }

    pub fn read_authoritative(self) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        let path = self.authoritative_path()?;
        match self.storage.read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(PluginError::Internal(format!("{path}: {error}").into())),
        }
    }

    pub fn list_authoritative(self) -> std::result::Result<Vec<String>, PluginError> {
        let (root, dir) = if self.authoritative_uses_canonical()? {
            (&self.canonical_root, &self.canonical_path)
        } else {
            (&self.cache_root, &self.cache_path)
        };
        let mut paths = Vec::new();
        collect_data_files(self.storage.as_ref(), root, dir, &mut paths).map_err(|source| {
            PluginError::from(KernelError::Io {
                path: dir.clone(),
                source,
            })
        })?;
        // Il parcheggio del kernel non è dei plugin: elencare la radice non lo
        // mostra (FUB-003), come nominarlo non lo apre.
        let parked = format!("{}/", fub_abi::rules::doc_data::PARKED_SPACE);
        paths.retain(|path| !path.starts_with(&parked));
        paths.sort_unstable();
        Ok(paths)
    }

    pub fn read_cache(self) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        match self.storage.read(&self.cache_path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(PluginError::Internal(
                format!("{}: {error}", self.cache_path).into(),
            )),
        }
    }

    pub fn write_authoritative(self, bytes: &[u8]) -> std::result::Result<(), PluginError> {
        let path = self.authoritative_path()?;
        self.storage
            .write(path, bytes)
            .map(|_| ())
            .map_err(|error| PluginError::Io(format!("{path}: {error}").into()))
    }

    pub fn remove_authoritative(self) -> std::result::Result<(), PluginError> {
        let path = self.authoritative_path()?;
        match self.storage.remove(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(PluginError::Io(format!("{path}: {error}").into())),
        }
    }

    pub fn write_cache(self, bytes: &[u8]) -> std::result::Result<(), PluginError> {
        claim_plugin_cache_root(
            self.storage.as_ref(),
            &self.canonical_root,
            &self.cache_root,
            &self.cache_mark,
        )?;
        self.storage
            .write(&self.cache_path, bytes)
            .map(|_| ())
            .map_err(|error| PluginError::Io(format!("{}: {error}", self.cache_path).into()))
    }
}

impl Workspace {
    // --- l'organizzazione del vault (§11.3) --------------------------------
    //
    // **Per chiave, non a blob intero**, ed è la riga che questa voce esiste
    // per scrivere: prima la shell rileggeva tutto, cambiava un campo e
    // riscriveva tutto, quindi due finestre sullo stesso vault erano una *lost
    // update* — la seconda che salva cancella ciò che ha fatto la prima, e
    // nessuna delle due se ne accorge.
    //
    // Non sono capacità dell'`HostApi` ma metodi del workspace: **nessun plugin
    // le chiede ancora**, e una capacità concessa a nessuno è superficie da
    // mantenere, documentare e sandboxare per sempre — è la regola del §1.6, e
    // vale anche quando la cosa da non aggiungere è comoda. Leggere invece passa
    // dal canale dati, che chiunque ha.

    /// L'organizzazione di questo vault: icone, appuntate, ordinamenti, spazi.
    pub fn organization(&self) -> fub_abi::organization::Organization {
        self.organization.snapshot()
    }

    /// Lo store owned dell'organizzazione, per i confini host che devono
    /// rilasciare il prestito del workspace prima della persistenza.
    pub fn organization_store(&self) -> Arc<OrganizationStore> {
        Arc::clone(&self.organization)
    }

    /// L'emoji accanto a una nota o a una cartella (`None` la toglie).
    pub fn set_icon(&self, path: &str, icon: Option<String>) -> std::result::Result<(), String> {
        self.organization.set_icon(path, icon)
    }

    /// Appunta o spunta una nota.
    pub fn set_pinned(&self, id: &str, pinned: bool) -> std::result::Result<(), String> {
        self.organization.set_pinned(id, pinned)
    }

    /// Registra o toglie una cartella dagli spazi.
    pub fn set_space(&self, path: &str, is_space: bool) -> std::result::Result<(), String> {
        self.organization.set_space(path, is_space)
    }

    /// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
    pub fn set_order(&self, folder: &str, names: Vec<String>) -> std::result::Result<(), String> {
        self.organization.set_order(folder, names)
    }

    /// Cosa è andato storto con l'organizzazione: il file illeggibile
    /// all'apertura, o una migrazione che non si è potuta scrivere. Chi monta le
    /// mostra, e svuotandole se ne fa carico.
    pub fn organization_warnings(&self) -> Vec<String> {
        self.organization.take_warnings()
    }

    /// Quali spazi per-documento non hanno potuto seguire una rinomina (§13.2).
    /// Chi monta le mostra, e svuotandole se ne fa carico.
    pub fn doc_data_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.doc_data_warnings)
    }

    /// Porta dietro a una rinomina lo stato per-documento di **ogni** plugin
    /// (§13.2), e annota chi non ce l'ha fatta.
    ///
    /// Non torna un `Result` e non può tornarlo: chi la chiama ha già spostato
    /// il file, e annullare una rinomina riuscita perché un plugin non ha potuto
    /// seguirla sarebbe il verso sbagliato. È la stessa regola
    /// dell'organizzazione, applicata a chi non è il kernel.
    pub(super) fn migrate_doc_data(&mut self, from: &DocId, to: &DocId) {
        let roots = self.docs.plugin_data_roots();
        let storage = Arc::clone(self.docs.vault.storage());
        for error in crate::docdata::migrate_data(storage.as_ref(), &roots, from, to) {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {from} non ha potuto seguire la rinomina \
                 in {to} — {error}"
            ));
        }
    }

    /// Toglie lo stato per-documento delle note che non esistono più (§13.2).
    ///
    /// È un **giro sul disco** e non una reazione a un evento, ed è la sola
    /// forma che funziona: la cancellazione definitiva la si può perdere (una
    /// nota tolta dal cestino ad app chiusa non la annuncia nessuno), un giro
    /// no. Gira all'apertura, quando l'anagrafe è appena stata ricostruita.
    ///
    /// «Non esiste più» vuol dire né indicizzata **né nel cestino**: una nota
    /// cestinata è recuperabile, e ripristinarla senza i suoi dati sarebbe una
    /// perdita silenziosa fatta da chi doveva impedirla.
    /// Esegue un comando di manutenzione (§15.2).
    ///
    /// Sta qui e non in un `CommandProvider` per la ragione scritta in testa a
    /// [`crate::maintenance`]: ciò che questi comandi fanno non è una capacità
    /// dell'`HostApi`, e non deve diventarlo per poterli scrivere.
    ///
    /// Il **modo** è onorato come per ogni altro comando: una simulazione dice
    /// cosa farebbe e non lo fa. Che i tre siano innocui non è una ragione per
    /// saltare quel ramo — chi simula una macro che li contiene si aspetta un
    /// piano, non un vault reindicizzato.
    pub(super) fn run_maintenance(
        &mut self,
        command: &str,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        use crate::maintenance::{
            Diagnostics, BUNDLE_FILE, DIAGNOSTICS_VERSION, VAULT_CLEAR_JOURNAL,
            VAULT_DIAGNOSTIC_BUNDLE, VAULT_REBUILD_INDEX, VAULT_REPAIR,
        };
        if mode.is_dry_run() {
            // Il piano è **vuoto di documenti** per tutti e quattro, e non è una
            // lacuna: nessuno tocca una nota, quindi l'insieme impattato è
            // davvero vuoto. Il sommario però non è vuoto per tutti — è il campo
            // che esiste per dire «cosa succede» in una riga, e i tre che
            // riparano non hanno niente da dire mentre il quarto **perde
            // qualcosa** e chi approva deve vederne il conto.
            let mut plan = fub_abi::command::CommandPlan::default();
            if command == VAULT_CLEAR_JOURNAL {
                plan.summary = Text::message(
                    crate::maintenance::T_JOURNAL_PLAN,
                    vec![fub_abi::text::Arg::int(
                        crate::maintenance::A_LINES,
                        self.journal()?.records.len() as i64,
                    )],
                );
            }
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        match command {
            VAULT_REBUILD_INDEX => {
                let opening = self.reindex().map_err(|and| {
                    PluginError::Internal(format!("l'indice non si è rifatto: {and}").into())
                })?;
                Ok(self.rebuild_index_outcome(opening))
            }
            VAULT_REPAIR => {
                // Il rebuild rifà il derivato; questo raccoglie ciò che il
                // rebuild non guarda — i dati attaccati a note che non ci sono
                // più — e **dice** ciò che non ripara, invece di tacerlo.
                let collected = self.collect_doc_data()?;
                let journal = self.journal()?;
                let drafts = self.drafts()?;
                let orfane = drafts
                    .drafts
                    .iter()
                    .filter(|b| !self.indexes.core.entries.contains_key(&b.doc))
                    .count();
                // Il messaggio è **una chiave per caso**, e non una frase
                // composta a pezzi: concatenare stringhe tradotte produce testo
                // che nella lingua dopo non sta in piedi (0040).
                let key = if journal.pruned > 0 || drafts.pruned > 0 || orfane > 0 {
                    crate::maintenance::T_REPAIRED_PARZIALE
                } else {
                    crate::maintenance::T_REPAIRED
                };
                // Le due righe che questo comando **non** ripara si dicono, e
                // sono due specie diverse di cosa: una riga di registro rotta è
                // perduta, una bozza orfana è l'unica copia di un testo — e la
                // seconda si ripara solo decidendo, cioè non qui.
                Ok(CommandOutcome::notify(Text::message(
                    key,
                    vec![
                        fub_abi::text::Arg::int(crate::maintenance::A_COLLECTED, collected as i64),
                        fub_abi::text::Arg::int(crate::maintenance::A_LOST, journal.pruned as i64),
                        fub_abi::text::Arg::int(crate::maintenance::A_UNREAD, drafts.pruned as i64),
                        fub_abi::text::Arg::int(crate::maintenance::A_ORPHANS, orfane as i64),
                    ],
                )))
            }
            VAULT_DIAGNOSTIC_BUNDLE => {
                let journal = self.journal()?;
                let drafts = self.drafts()?;
                let orfane = drafts
                    .drafts
                    .iter()
                    .filter(|b| !self.indexes.core.entries.contains_key(&b.doc))
                    .count();
                // Il primo lettore vero di `IndexQuery::VaultHealth`: quella
                // query esisteva e non la chiedeva nessuno.
                //
                // L'elenco è `HealthCheck::ALL` e non tre righe scritte qui: un
                // elenco a mano che si dimentica un controllo lascia il rapporto
                // valido — è ancora un array — con una riga in meno, e nessun
                // presidio guarda dentro quell'array.
                let health = fub_abi::traits::HealthCheck::ALL
                    .into_iter()
                    .map(|check| {
                        let count =
                            match self.query_index(IndexQuery::VaultHealth { check, page: None }) {
                                Ok(IndexResult::VaultHealth(page)) => page.total as usize,
                                _ => 0,
                            };
                        (format!("{check:?}"), count)
                    })
                    .collect();
                let report = Diagnostics {
                    v: DIAGNOSTICS_VERSION,
                    at: self.now_unix_millis(),
                    fub: env!("CARGO_PKG_VERSION").to_string(),
                    documents: self.indexes.core.metas.len(),
                    entries: self.indexes.core.entries.len(),
                    journal_pruned: journal.pruned,
                    drafts: drafts.drafts.len(),
                    drafts_orphans: orfane,
                    health,
                };
                let bytes = serde_json::to_vec_pretty(&report)
                    .map_err(|and| PluginError::Internal(format!("rapporto: {and}").into()))?;
                let path = crate::vault::data_root(self.docs.vault.root()).join(BUNDLE_FILE);
                // Dal **supporto**, come ogni altro byte sotto la linea del
                // vault: un rapporto scritto con `std::fs` sarebbe il primo file
                // di Fub a non essere né atomico né cifrabile.
                self.docs
                    .vault
                    .storage()
                    .write(&path, &bytes)
                    .map_err(|and| PluginError::Internal(format!("rapporto: {and}").into()))?;
                Ok(CommandOutcome::notify(Text::message(
                    crate::maintenance::T_BUNDLE_WRITTEN,
                    vec![fub_abi::text::Arg::text(
                        crate::maintenance::A_PATH,
                        path.as_str(),
                    )],
                )))
            }
            VAULT_CLEAR_JOURNAL => {
                // L'unico dei quattro il cui esito **risale**: gli altri tre non
                // perdono niente, quindi un guasto si può raccontare e basta.
                // Qui l'utente ha chiesto che una cosa sparisca, e una richiesta
                // di far sparire qualcosa che fallisce in silenzio è la peggiore
                // delle risposte — chi l'ha chiesta se ne va credendo che sia
                // sparita.
                let count = self
                    .journal
                    .clear()
                    .map_err(|and| PluginError::Internal(format!("registro: {and}").into()))?;
                Ok(CommandOutcome::notify(Text::message(
                    crate::maintenance::T_JOURNAL_CLEARED,
                    vec![fub_abi::text::Arg::int(
                        crate::maintenance::A_LINES,
                        count as i64,
                    )],
                )))
            }
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }

    pub(super) fn rebuild_index_outcome(&self, opening: Opening) -> CommandOutcome {
        CommandOutcome::notify(Text::message(
            crate::maintenance::T_REBUILT,
            vec![
                fub_abi::text::Arg::int(
                    crate::maintenance::A_DOCS,
                    self.indexes.core.metas.len() as i64,
                ),
                fub_abi::text::Arg::int(
                    crate::maintenance::A_ENTRIES,
                    self.indexes.core.entries.len() as i64,
                ),
                fub_abi::text::Arg::int(
                    crate::maintenance::A_SKIPPED,
                    opening.discarded.len() as i64,
                ),
            ],
        ))
    }

    /// **Toglie lo spazio per-documento delle note che non ci sono più** (§13.2),
    /// e dice quante ne ha tolte.
    ///
    /// Passa di qui e non da un evento: la cancellazione definitiva si può
    /// perdere — svuotare il cestino ad app chiusa non lo annuncia nessuno —
    /// mentre un giro sul disco no. Il momento giusto è subito dopo
    /// [`finish_index`](Workspace::finish_index), quando l'anagrafe è appena
    /// stata ricostruita ed è al suo massimo di verità.
    ///
    /// # Perché prende `&self`, e perché non basta che lo prenda
    ///
    /// Perché non tocca il workspace: guarda l'anagrafe, cammina il disco degli
    /// spazi dati e toglie cartelle. Stava dentro `finish_index`, cioè dentro il
    /// prestito **esclusivo**, e su un vault con una storia per nota quel giro è
    /// un `readdir` più uno `stat` per documento — più il cestino, che si legge
    /// per intero. Chi disegna il vault appena aperto lo aspettava tutto.
    ///
    /// Il prestito **condiviso** non è solo più corto: è l'unico che tiene in
    /// piedi ciò che questa funzione decide. «Questo documento non c'è più» si
    /// legge dall'anagrafe e si esegue cancellando, e fra le due cose nessuno
    /// deve poter far tornare quel documento — se no si cancella lo spazio di una
    /// nota viva. Chiunque lo farebbe vuole `&mut`, quindi il prestito condiviso
    /// lo esclude: la finestra fra il giudizio e la cancellazione non esiste,
    /// senza che serva un piano da invalidare (0119).
    ///
    /// **Chi la chiama**: [`reindex`](Workspace::reindex) per il giro sincrono,
    /// il runner di `fub-host` per l'apertura a fasi, e `vault.repair`. Che il
    /// secondo non se la dimentichi lo guarda un banco, non questa riga.
    ///
    /// **Quante ne ha tolte, o cosa non è riuscita a togliere.** Una
    /// cancellazione parziale prima era indistinguibile da una riuscita — il
    /// conto tornava più piccolo e basta — e chi resta indietro sul disco non lo
    /// segnalava nessuno. Adesso il guasto risale, e sono i due chiamanti a
    /// decidere cosa farne: l'apertura lo registra e prosegue, `vault.repair` lo
    /// dice a chi l'ha chiesto.
    pub fn collect_doc_data(&self) -> Result<usize> {
        // **Una raccolta si fa su un'anagrafe che si dichiara completa, o non si
        // fa** (§23.1). È la stessa riga con cui `finish_index` non riconcilia
        // un'indicizzazione interrotta, applicata al suo vicino di tre righe
        // sotto — dove mancava, e dove costava incomparabilmente di più: chi
        // riconcilia su un insieme parziale svuota un **derivato**, che si rifà
        // riaprendo; chi raccoglie su un insieme parziale cancella dal disco lo
        // spazio per-documento di note che esistono, e quello non lo rifà
        // nessuno. Ci si arrivava premendo «annulla» sulla prima
        // indicizzazione di un vault grande, o chiudendo l'app mentre girava.
        //
        // `Ready` è il **default** di questo stato, quindi la guardia non chiude
        // la porta a chi raccoglie senza aver aperto niente: chiude a chi ha
        // aperto a metà, che è l'unico caso in cui l'anagrafe mente.
        if self.indexes.core.watch.indexing != IndexingState::Ready {
            return Ok(0);
        }
        let roots = self.docs.plugin_data_roots();
        if roots.is_empty() {
            return Ok(0);
        }
        // Un'anagrafe che non si è letta non dice cosa c'era ieri: il
        // ricongiungimento non ha visto le rinomine fatte ad app chiusa, e chi
        // raccogliesse ora toglierebbe i dati di note che hanno cambiato nome.
        if let Some(fault) = self.entry_store.unread_fault() {
            return Err(fault);
        }
        let _phase = tracing::info_span!(target: "fub.apertura", "collect_doc_data").entered();
        // Un cestino illeggibile ferma la raccolta: preso per vuoto, toglieva
        // i dati di ogni nota cestinata, che è ancora recuperabile.
        let trashed = self.trashed_originals()?;
        let metas = &self.indexes.core.metas;
        // Un allegato non è un documento ma è una voce dell'anagrafe, e il suo
        // spazio per-documento è vivo quanto quello di una nota: è la stessa
        // domanda di [`is_trashable`](Workspace::is_trashable).
        let entries = &self.indexes.core.entries;
        // Ciò che il ricongiungimento ha messo in dubbio non si raccoglie: è la
        // terza regola di [`rejoin_renamed_while_closed`], e vive qui perché la
        // raccolta ha due chiamanti — l'apertura e `vault.repair` — e uno di
        // essi gira quando quel dubbio non è più in vista.
        let suspended = &self.suspended_from_rejoin;
        let storage = Arc::clone(self.docs.vault.storage());
        // **L'anagrafe dice cosa partecipa al vault, non cosa c'è sul disco.**
        // Una nota di una cartella aggiunta a `files.excluded-folders`, o un
        // dotfile quando i nascosti tornano nascosti, esce dall'anagrafe ma
        // resta dov'era: togliere l'impostazione la rimette com'era, e la
        // raccolta era l'unica mossa della catena che non si disfaceva. Si
        // chiede quindi al disco, e soltanto per chi è già candidato: un file
        // che c'è non è sparito, e un `stat` che fallisce per altro che
        // l'assenza non dice che sia sparito.
        let on_disk = |doc: &DocId| {
            self.docs
                .vault
                .path_for(doc)
                .is_ok_and(|path| !matches!(crate::error::optional(storage.stat(&path)), Ok(None)))
        };
        let collected = crate::docdata::collect(storage.as_ref(), &roots, &|doc: &DocId| {
            metas.contains_key(doc)
                || entries.contains_key(doc)
                || trashed.may_hold(doc)
                || suspended.contains(doc)
                || on_disk(doc)
        })?;
        // Lo spazio che una nota ha messo al sicuro cestinandosi vive quanto la
        // sua voce: finché è nel cestino è recuperabile, e con lei il suo stato.
        let parked = crate::docdata::collect_parked(storage.as_ref(), &roots, &|trash: &DocId| {
            trashed.holds_entry(trash)
        })?;
        Ok(collected + parked)
    }

    /// I documenti da cui il cestino è passato: ciò che sta lì dentro **non è
    /// sparito**, è recuperabile.
    ///
    /// Un cestino che non si elenca non è un cestino vuoto, e un sidecar che
    /// non si legge non è un sidecar assente: l'errore risale, perché chi ne
    /// ricava una cancellazione deve potersi fermare
    /// ([`Vault::trash_originals`](crate::vault::Vault::trash_originals)).
    pub(super) fn trashed_originals(&self) -> Result<crate::vault::TrashOrigins> {
        self.docs.vault.trash_originals()
    }

    /// **Riconosce le rinomine che non ha visto nessuno** (§23.1), e restituisce
    /// i documenti su cui il dubbio ha sospeso il giudizio.
    ///
    /// # Il problema
    ///
    /// Il path è la chiave, e lo è per sempre
    /// ([0043](../../../docs/decisions/0188-identita-path-e-rename.md)). Chi
    /// rinomina una nota mentre Fub è aperto — dalla shell, dal Finder, da un
    /// client di sync — la fa seguire da tutto ciò che le sta attaccato, perché
    /// il rilevatore accoppia i due path e si finisce in
    /// [`migrate_identity`](Workspace::migrate_identity). Chi la rinomina mentre
    /// Fub è **chiuso** non ha nessuno che accoppi: alla riapertura una nota
    /// risulta sparita e ne risulta nata un'altra, e lo spazio per-documento, le
    /// versioni e — l'unica copia di un testo mai salvato — la **bozza** restano
    /// attaccati a un nome che non esiste più.
    ///
    /// Non è il caso di frontiera: un client di sync che rinomina ad app chiusa
    /// è il caso *normale* di chi tiene il vault su due macchine.
    ///
    /// # La terza strada
    ///
    /// La 0043 ha scartato l'id esterno, e giustamente — una tabella
    /// `path → id` tenuta dal kernel è «il path con un costume addosso». Ma la
    /// riassociazione non deve passare da un id: passa dal **contenuto**. Il
    /// materiale è già tutto su disco e non costa una lettura in più:
    /// l'anagrafe è durevole fra un avvio e l'altro
    /// ([0046](../../../docs/decisions/0188-identita-path-e-rename.md)) e porta
    /// l'impronta di ogni documento che qualcuno ha letto, e l'impronta di ciò
    /// che è comparso oggi l'ha appena calcolata
    /// [`plan_batch`](Workspace::plan_batch) leggendolo.
    ///
    /// # Le tre regole, e perché nessuna si poteva scrivere senza deciderla
    ///
    /// 1. **Uno a uno, o niente.** Due impronte uguali sono una rinomina solo se
    ///    una nota è *sparita*: due file identici comparsi senza che sparisse
    ///    niente sono una copia, e trattarli come una rinomina sposterebbe la
    ///    bozza dell'uno sull'altro. E quando ne spariscono N e ne compaiono N
    ///    con la stessa impronta, l'accoppiamento non è unico.
    /// 2. **Nel dubbio non si accoppia**, ed è il verso *opposto* a quello della
    ///    [0085](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md): là nel
    ///    dubbio si conta come cambiamento, perché una rilettura di troppo costa
    ///    un file aperto. Qui un accoppiamento sbagliato consegna il testo non
    ///    salvato di una nota a un'altra, e non c'è nessun «di troppo» che
    ///    costi così poco.
    /// 3. **Nel dubbio non si nemmeno raccoglie.** Se le due mosse restano una
    ///    sola — non accoppiare — il dubbio finisce a `remove_dir_all`, che è
    ///    irreversibile, mentre aspettare costa qualche byte fermo. Quindi ciò
    ///    che questa funzione mette in dubbio esce dalla porta e la raccolta lo
    ///    salta: se domani l'ambiguità si scioglie (l'utente cancella la copia
    ///    di troppo), il giro dopo accoppia.
    ///
    /// # Cosa resta fuori, e non per dimenticanza
    ///
    /// - **Il file vuoto**, che con un altro file vuoto ha per forza la stessa
    ///   impronta: zero byte non sono una prova di identità, sono l'assenza di
    ///   una prova. È il caso in cui la regola 1 sarebbe soddisfatta e la
    ///   conclusione falsa.
    /// - **Il cestino**: una nota cestinata non è sparita, è recuperabile, e
    ///   spostarne i dati su un omonimo li toglierebbe a chi la ripristina.
    /// - **Gli allegati**: la seconda fase calcola la stessa impronta dei
    ///   documenti direttamente dai byte, così una rinomina ad app chiusa può
    ///   ricongiungersi qui senza una riga di codice dedicata.
    /// - **Un'anagrafe che non si è potuta leggere** (versione ignota, file
    ///   rotto): niente ieri, niente spariti, nessuna rinomina da vedere. Il
    ///   ricongiungimento è una capacità di un **derivato**, e perso il derivato
    ///   si perde anche lei — per un giro, e in silenzio.
    pub(super) fn rejoin_renamed_while_closed(&self) -> (Vec<(DocId, DocId)>, BTreeSet<DocId>) {
        // Qui il cestino è una cautela in più, non la guardia: l'accoppiamento
        // chiede lo stesso file (identità e impronta), e un file che sta nel
        // cestino non è una voce del vault di oggi.
        let trashed = self.trashed_originals().unwrap_or_default();
        // C'era ieri, oggi non c'è, e portava l'impronta di un contenuto.
        //
        // La domanda si fa sulla tabella dov'è, senza copiarla (#523): si
        // leggono misura, identità e impronta, e si copia l'impronta delle
        // sole righe sparite. Dentro solo lavoro in memoria, e nessuna
        // domanda all'anagrafe: rientrare nel suo lucchetto di lettura con
        // uno scrittore in attesa può bloccarsi.
        let disappeared = self.entry_store.with_all_known(|known| {
            let mut disappeared: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =
                BTreeMap::new();
            for (id, entry) in known {
                if entry.size == 0
                    || self.indexes.core.entries.contains_key(id)
                    || trashed.may_hold(id)
                {
                    continue;
                }
                if let (Some(identity), Some(fingerprint)) =
                    (entry.identity, entry.fingerprint.clone())
                {
                    disappeared
                        .entry((identity, fingerprint))
                        .or_default()
                        .push(id.clone());
                }
            }
            disappeared
        });
        if disappeared.is_empty() {
            return (Vec::new(), BTreeSet::new());
        }

        // Oggi c'è, ieri non c'era. Si guardano solo le impronte per cui
        // qualcosa è sparito: un vault appena aperto per la prima volta ha
        // tutto «comparso» e niente «sparito», e non deve costare una mappa
        // grande quanto il vault per scoprirlo.
        let mut appeared: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =
            BTreeMap::new();
        for entry in self.indexes.core.entries.values() {
            // Fuori da `with_all_known`, e senza copiare la riga: basta
            // sapere se c'è.
            if entry.size == 0 || self.entry_store.ask_known(&entry.id, |_| ()).is_some() {
                continue;
            }
            let (Some(identity), Some(fingerprint)) = (
                self.docs.vault.file_identity(&entry.id),
                entry.fingerprint.clone(),
            ) else {
                continue;
            };
            let key = (identity, fingerprint);
            if disappeared.contains_key(&key) {
                appeared.entry(key).or_default().push(entry.id.clone());
            }
        }

        let mut suspended = BTreeSet::new();
        let mut pairs: Vec<(DocId, DocId)> = Vec::new();
        for (identity_and_digest, mut from) in disappeared {
            let Some(a) = appeared.get(&identity_and_digest) else {
                // Nessun candidato: non è una rinomina, è una cancellazione. La
                // raccolta se ne occupa come si è sempre occupata.
                continue;
            };
            if from.len() == 1 && a.len() == 1 {
                pairs.push((from.remove(0), a[0].clone()));
            } else {
                suspended.extend(from);
            }
        }

        for (from, to) in &pairs {
            // Il pavimento e la porta insieme (0062): una riga nel log per chi
            // fa assistenza, e l'evento di `announce_rejoin` per chi sta dentro
            // l'app.
            tracing::info!(
                target: "fub.kernel",
                "rinomina fatta ad app chiusa riconosciuta dall'impronta: {from} → {to}"
            );
        }
        (pairs, suspended)
    }

    /// Le rinomine riconosciute, portate dietro **subito**: è la via di chi
    /// tiene il workspace intero (`finish_index`, `reindex`).
    pub(super) fn rejoin_now(&mut self, pairs: Vec<(DocId, DocId)>) {
        for (from, to) in &pairs {
            self.migrate_side_data(from, to);
        }
        self.announce_rejoin(pairs);
    }

    /// **E poi si dice**, con lo stesso evento della rinomina vista: chi tiene
    /// stato per-documento fuori dallo spazio dichiarato — il versioning, che
    /// ha uno store suo perché deve sopravvivere alla cancellazione (0044) —
    /// non ha altro modo di saperlo. Che la coda possa troncare (0034) è la
    /// ragione per cui i tre dati autorevoli che il kernel sa spostare sono
    /// stati spostati **prima**, e non aspettando che qualcuno ascoltasse.
    pub(super) fn announce_rejoin(&mut self, pairs: Vec<(DocId, DocId)>) {
        if pairs.is_empty() {
            return;
        }
        self.as_actor(Actor::Kernel, |ws| {
            for (from, to) in pairs {
                ws.emit_event(Event::DocumentRenamed { from, to });
            }
        });
    }

    /// Dice le rinomine di un [`PendingRejoin`] già eseguito: gli avvisi dei
    /// dati che non hanno seguito, e un `DocumentRenamed` per ognuna. Non
    /// tocca il disco.
    pub fn finish_rejoin(&mut self, completed: CompletedRejoin) {
        let CompletedRejoin {
            pairs,
            doc_data_warnings,
        } = completed;
        self.doc_data_warnings.extend(doc_data_warnings);
        self.announce_rejoin(pairs);
        self.dispatch_pending();
    }

    /// Cosa è andato storto **leggendo** la configurazione: un file malformato,
    /// una chiave di macchina scritta dentro un vault, un valore che non regge
    /// la specie dichiarata. Chi monta le mostra, e svuotandole se ne fa carico.
    pub fn settings_warnings(&mut self) -> Vec<String> {
        self.settings
            .write()
            .expect("store di configurazione")
            .take_warnings()
    }

    /// Il livello macchina di questo workspace, da condividere con il prossimo
    /// vault che si apre (§11.1): la configurazione della macchina è **una**, e
    /// N copie sarebbero N idee del tema.
    pub fn machine_settings(&self) -> Arc<MachineSettings> {
        Arc::clone(
            self.settings
                .read()
                .expect("store di configurazione")
                .machine(),
        )
    }

    // --- interni ---------------------------------------------------------

    // --- storage persistente dei plugin ------------------------------------

    /// La radice dello spazio dati di un plugin, **come cartella del
    /// filesystem**.
    ///
    /// È **l'unico varco del filesystem fuori da `VaultStorage`**
    /// ([0064](../../../docs/decisions/0185-capability-un-solo-guard.md)): ogni
    /// altro byte di un vault passa dal supporto, e lì la cifratura si ferma
    /// qui. Per questo è un metodo del workspace e non una capacità
    /// dell'[`HostApi`]: `data_*` nomina blob, non file, ed è tutto ciò che un
    /// plugin WASM avrà. Un provider nativo che avvolge un motore con un
    /// proprio formato su disco (tantivy mmappa i suoi segmenti e li rilegge
    /// quando gli pare, anche dai thread di merge) ha bisogno di una vera
    /// cartella: questa è quella cartella, **dentro lo stesso recinto** di
    /// tutto il resto. A M5 l'equivalente per un componente è un preopen WASI
    /// sulla stessa radice — un plugin WASM non riceverà mai una cartella dal
    /// kernel.
    ///
    /// Chi la chiama è elencato e presidiato in
    /// `crates/fub-kernel/tests/il_supporto.rs`: oggi solo la ricerca.
    ///
    /// Rifiuta un id che non sia un nome semplice, con la stessa regola dei
    /// path di `data_*`: il recinto è uno.
    pub fn plugin_data_dir(&self, plugin: &str) -> std::result::Result<Utf8PathBuf, PluginError> {
        self.plugin_data_path(plugin, "")
    }

    /// La radice dello spazio dati di un plugin.
    pub(crate) fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_data_root(plugin)
    }

    /// La radice derivata della cache di un plugin.
    pub(crate) fn plugin_cache_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_cache_root(plugin)
    }

    /// Il supporto del vault (§15.1), per chi implementa `data_*`: lo spazio
    /// dati di un plugin sta **dentro** il vault, e ci si scrive con lo stesso
    /// supporto con cui si scrivono i documenti.
    pub(crate) fn storage(&self) -> &Arc<dyn crate::storage::VaultStorage> {
        self.docs.vault.storage()
    }

    /// Traduce un path relativo dello spazio di un plugin in un path assoluto,
    /// rifiutando **tutto** ciò che proverebbe a uscirne.
    ///
    /// Il recinto è qui e in nessun altro posto: il plugin nomina blob, non
    /// path del filesystem, e non ha modo di sapere dove sia la radice del
    /// vault. `rel` vuoto è la radice stessa (serve a `data_list`).
    pub(crate) fn plugin_data_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        let denied = |why: &str| PluginError::PermissionDenied(format!("`{rel}`: {why}").into());
        if !is_safe_component(plugin) {
            return Err(PluginError::PermissionDenied(
                format!("id di plugin non utilizzabile come spazio dati: `{plugin}`").into(),
            ));
        }
        let mut path = self.plugin_data_root(plugin);
        if rel.is_empty() {
            return Ok(path);
        }
        // I separatori sono `/` e basta: un `\` su Windows sarebbe un
        // separatore, e qui deve restare un carattere qualunque — cioè un nome
        // di file illegale, non una via d'uscita.
        if rel.contains('\\') {
            return Err(denied("i separatori di path sono `/`"));
        }
        // `doc~trash` è il parcheggio del kernel (FUB-003): lo stato delle note
        // cestinate sta lì, e la raccolta lo toglie per le voci che il cestino
        // non tiene più. Un plugin che ci scrivesse metterebbe i suoi dati dove
        // il kernel li butta, e uno che ci leggesse vedrebbe lo stato di una
        // nota che non è sua.
        if rel.split('/').next() == Some(fub_abi::rules::doc_data::PARKED_SPACE) {
            return Err(denied(
                "`doc~trash` è riservato al kernel: lì sta lo stato delle note cestinate",
            ));
        }
        for comp in rel.split('/') {
            if !is_safe_component(comp) {
                return Err(denied("path assoluti e risalite non sono ammessi"));
            }
            path.push(comp);
        }
        Ok(path)
    }

    /// Traduce un path relativo nello spazio derivato della cache.
    pub(crate) fn plugin_cache_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        let data_path = self.plugin_data_path(plugin, rel)?;
        let relative = data_path
            .strip_prefix(self.plugin_data_root(plugin))
            .map_err(|_| PluginError::Internal("cache path outside plugin root".into()))?;
        Ok(self.plugin_cache_root(plugin).join(relative))
    }

    pub(super) fn plugin_cache_mark_path(&self, plugin: &str) -> Utf8PathBuf {
        self.plugin_cache_root(plugin).join(PLUGIN_CACHE_MARK)
    }

    /// `.fub/data/plugins/<id>/` esiste e **non** è cache: è l'albero vecchio.
    pub(crate) fn plugin_legacy_is_authoritative(
        &self,
        plugin: &str,
    ) -> std::result::Result<bool, PluginError> {
        let present = |path: &Utf8Path| plugin_root_present(self.storage().as_ref(), path);
        Ok(present(&self.plugin_cache_root(plugin))?
            && !present(&self.plugin_cache_mark_path(plugin))?)
    }

    pub(crate) fn plugin_authoritative_uses_canonical(
        &self,
        plugin: &str,
    ) -> std::result::Result<bool, PluginError> {
        Ok(
            plugin_root_present(self.storage().as_ref(), &self.plugin_data_root(plugin))?
                || !self.plugin_legacy_is_authoritative(plugin)?,
        )
    }

    pub(crate) fn plugin_authoritative_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        if self.plugin_authoritative_uses_canonical(plugin)? {
            self.plugin_data_path(plugin, rel)
        } else {
            self.plugin_cache_path(plugin, rel)
        }
    }

    /// Congela supporto, namespace e path validati per una singola operazione
    /// `data_*`; il token non esegue I/O finché non viene invocato.
    pub fn prepare_plugin_data_io(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<PreparedPluginDataIo, PluginError> {
        let canonical_root = self.plugin_data_root(plugin);
        let cache_root = self.plugin_cache_root(plugin);
        let canonical_path = self.plugin_data_path(plugin, rel)?;
        let relative = canonical_path
            .strip_prefix(&canonical_root)
            .map_err(|_| PluginError::Internal("cache path outside plugin root".into()))?;
        let cache_path = cache_root.join(relative);
        Ok(PreparedPluginDataIo {
            storage: Arc::clone(self.storage()),
            cache_mark: cache_root.join(PLUGIN_CACHE_MARK),
            canonical_root,
            cache_root,
            canonical_path,
            cache_path,
        })
    }

    /// Prima di `cache_write`: se il vecchio albero è ancora autorevole, lo
    /// porta in `.fub/plugins/<id>/`. Poi posa il marcatore, così un plugin
    /// nuovo che scrive solo cache non rende quei blob visibili a `data_read`
    /// ([`claim_plugin_cache_root`], la stessa del percorso staccato).
    pub(crate) fn prepare_plugin_cache_write(
        &self,
        plugin: &str,
    ) -> std::result::Result<(), PluginError> {
        claim_plugin_cache_root(
            self.storage().as_ref(),
            &self.plugin_data_root(plugin),
            &self.plugin_cache_root(plugin),
            &self.plugin_cache_mark_path(plugin),
        )
    }

    /// Freeze the storage handle and timer-cursor path without performing I/O.
    ///
    /// The returned token owns everything needed by a caller that must release
    /// its `Workspace` guard before touching the storage backend.
    pub fn prepare_timer_cursors(
        &self,
        owner: &str,
    ) -> std::result::Result<PreparedTimerCursors, PluginError> {
        Ok(PreparedTimerCursors {
            storage: Arc::clone(self.storage()),
            path: self.plugin_data_path(owner, TIMER_CURSORS_FILE)?,
        })
    }

    /// Legge i cursori dei timer del plugin dal dato autorevole del vault.
    ///
    /// Il file vive nello spazio dati del plugin (`.fub/plugins/<id>/`), la
    /// stessa radice centralizzata da `plugin_data_path`; non è una cache.
    pub fn timer_cursors(
        &self,
        owner: &str,
    ) -> std::result::Result<BTreeMap<String, CivilTime>, PluginError> {
        self.prepare_timer_cursors(owner)?.read()
    }

    /// Aggiorna atomicamente il cursore di un timer.
    ///
    /// Il valore durevole è un cursore cronologico: due worker possono avere
    /// preso fotografie in ordine diverso da quello in cui arrivano alla
    /// scrittura, ma una fotografia più vecchia non può riportare indietro
    /// quella già persistita. Il confronto avviene dentro l'update atomico,
    /// dopo la rilettura sotto il lock dello storage.
    pub fn set_timer_cursor(
        &self,
        owner: &str,
        timer: &str,
        cursor: CivilTime,
    ) -> std::result::Result<(), PluginError> {
        self.prepare_timer_cursors(owner)?.write(timer, cursor)
    }
}
