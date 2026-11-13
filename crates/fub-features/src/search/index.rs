//! `SearchIndex`: la struttura, l'apertura della cartella dell'indice e la
//! sua cancellazione.

use super::*;

/// Indice full-text del vault.
///
/// # Perché non c'è un lock attorno a tutto
///
/// Prima c'era: un `Mutex<Inner>` che [`IndexProvider::query`] prendeva a ogni
/// interrogazione, perché una query può dover **committare** le scritture in
/// sospeso (chi interroga vede sempre le proprie scritture — è il provider a
/// garantirlo, vedi il trait). Il risultato era che la lettura che l'utente
/// scatena più spesso non guadagnava niente dal prestito condiviso del
/// workspace: il `RwLock` del kernel non attraversa il lock di un provider, e
/// otto thread facevano le stesse ricerche al secondo di uno
/// ([decisione 0024](../../../docs/decisions/README.md)).
///
/// La garanzia non è stata tolta: è stato tolto il **prezzo di chi non la usa**.
/// Committare serve solo quando c'è qualcosa da committare, e chi scrive passa
/// da `&mut self` — cioè, nel kernel, dal prestito esclusivo del workspace.
/// Quindi:
///
/// - il **writer** è l'unica cosa dietro un lock, perché `IndexWriter::commit`
///   vuole `&mut self` mentre `add_document`/`delete_term` no;
/// - `dirty` è un atomico, e una query che lo trova falso — il caso normale —
///   non tocca nessun lock: legge un `bool` e va a interrogare il reader;
/// - `reader`, `index` e `fields` servono in sola lettura, e tantivy li dà per
///   condivisi (`searcher()` prende `&self`);
/// - `fingerprints` e `manifest_at` cambiano **solo** sotto `&mut self`, quindi
///   sono campi normali: è il compilatore a tenerli fuori dalla concorrenza,
///   non un lock.
pub struct SearchIndex {
    pub(super) index: Index,
    /// Il solo lock rimasto, e non sta sul percorso di una query pulita: lo
    /// prende chi scrive, e chi interroga **solo** se trova `dirty`.
    ///
    /// `Option` perché una chiusura lo **restituisce**: `IndexProvider::close`
    /// (decisione 0028) lo estrae e aspetta i thread di merge, che è il solo
    /// modo di lasciare andare il lock file della cartella prima che il processo
    /// muoia. Vuoto = questo indice è chiuso, e ciò che arriva dopo non ha più
    /// dove andare.
    pub(super) writer: Mutex<Option<IndexWriter>>,
    pub(super) reader: IndexReader,
    pub(super) fields: Fields,
    pub(super) fingerprints: HashMap<DocId, u64>,
    /// `DocId` → revisione del sorgente indicizzato (vedi [`Manifest::sources`]).
    pub(super) sources: HashMap<DocId, Revision>,
    /// Ciò che il kernel ha **appena dichiarato** chiedendo cosa è già a posto:
    /// `DocId` → revisione del sorgente che sta per consegnare.
    ///
    /// Serve perché [`IndexProvider::on_documents_indexed`] riceve un *modello*,
    /// e da un modello la revisione del sorgente non si ricalcola. L'unico
    /// posto in cui questo indice la vede è la domanda del kernel, e questa
    /// mappa è il tempo che passa fra la domanda e la consegna: si riempie in
    /// [`IndexProvider::up_to_date`] e si **consuma** documento per documento —
    /// e per documento si **invalida**: una domanda nuova su un id sostituisce
    /// la dichiarazione di prima e non tocca quelle degli altri, perché la
    /// domanda arriva per fetta e due fette non si annullano a vicenda.
    /// Consumare e non consultare è il punto: un documento che arriva senza
    /// dichiarazione — perché qualcuno l'ha salvato a sessione aperta — non
    /// deve raccogliere la revisione che la domanda dell'avvio aveva lasciato
    /// lì, che sarebbe quella di *prima* della modifica.
    ///
    /// `Mutex` perché la domanda arriva su `&self`: è una lettura per il
    /// contratto, ed è giusto che lo sia — chiedere cosa un indice ha già non
    /// lo cambia.
    pub(super) announced: Mutex<HashMap<DocId, Revision>>,
    /// Ci sono scritture accettate ma non ancora committate? Atomico perché lo
    /// spegne anche una `query`, che ha solo `&self`.
    pub(super) dirty: AtomicBool,
    /// L'opstamp dell'ultimo commit visto da questa istanza. Atomico per lo
    /// stesso motivo: lo alza anche il commit deciso da una query.
    pub(super) opstamp: AtomicU64,
    /// L'opstamp citato dal manifest attualmente su disco, se ce n'è uno di cui
    /// ci si fida. `None` = manifest assente, di un'altra epoca o da riscrivere.
    ///
    /// Non atomico: lo scrivono solo `activate` e `flush`, che hanno `&mut self`.
    pub(super) manifest_at: Option<u64>,
    /// Quanto pesa ciascun campo (§21.6). Condiviso con [`SearchSettings`], che
    /// è chi lo rinfresca: vedi [`FieldWeights`].
    pub(super) weights: Arc<RwLock<FieldWeights>>,
}

impl SearchIndex {
    /// Apre (o crea) l'indice dentro lo spazio dati che l'host assegna a questo
    /// provider (`Workspace::plugin_data_dir(SEARCH_ID)`).
    ///
    /// Il path arriva da fuori e non si compone qui: la disposizione dello
    /// spazio dati di un plugin è una scelta del kernel, e una feature che se la
    /// ricalcolasse per conto proprio ne terrebbe una seconda copia.
    ///
    /// Quel path è **l'unico varco del filesystem fuori da `VaultStorage`**
    /// ([0064](../../../docs/decisions/0185-capability-un-solo-guard.md)): la
    /// cifratura si ferma qui, ed è riservato ai provider nativi che mmappano —
    /// oggi solo questo. Un plugin WASM (M5) non lo avrà: avrà un preopen WASI
    /// sulla stessa cartella.
    pub fn open(plugin_data_root: &Utf8Path) -> Result<Self, PluginError> {
        Self::open_dir(&plugin_data_root.join(INDEX_DIR))
    }

    /// Apre (o crea) l'indice in una cartella specifica.
    pub fn open_dir(dir: &Utf8Path) -> Result<Self, PluginError> {
        let (schema, fields) = build_schema();

        // Un indice che non si apre, o il cui schema non è più il nostro, non
        // è un problema da diagnosticare: è stato derivato, si butta.
        let mut index = open_existing(dir, &schema);
        if index.is_none() {
            wipe(dir)?;
            std::fs::create_dir_all(dir).map_err(|and| io_err(dir, and))?;
            index = Some(
                Index::create_in_dir(dir, schema.clone())
                    .map_err(|and| PluginError::Internal(reason(INDEX_CREATE, and)))?,
            );
        }
        let index = index.expect("appena creato se assente");

        // Il writer prende un lock esclusivo sulla cartella. Fallire qui NON
        // deve portare a buttare l'indice: la causa quasi certa è che un'altra
        // istanza di Fub ha già questo vault aperto, e la sua copia è viva e
        // corretta. Si rinuncia alla ricerca, non ai dati di qualcun altro.
        let writer: IndexWriter = index.writer(WRITER_HEAP).map_err(|and| {
            PluginError::Internal(Text::message(
                INDEX_LOCKED,
                vec![
                    Arg::text(PATH, dir.to_string()),
                    Arg::text(REASON, and.to_string()),
                ],
            ))
        })?;
        let reader = index
            .reader_builder()
            // I commit li decidiamo noi (`flush`, o una query con scritture in
            // sospeso): niente thread di watch sul meta.json.
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|and| PluginError::Internal(reason(INDEX_READER, and)))?;

        // L'epoca dell'indice sul disco. Le impronte che le corrispondono
        // arrivano da `activate`, l'unico posto dove c'è un host per leggerle.
        let opstamp = index.load_metas().map(|m| m.opstamp).unwrap_or_default();

        Ok(SearchIndex {
            index,
            writer: Mutex::new(Some(writer)),
            reader,
            fields,
            fingerprints: HashMap::new(),
            sources: HashMap::new(),
            announced: Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(false),
            opstamp: AtomicU64::new(opstamp),
            manifest_at: None,
            // I default finché non c'è un host da cui leggere i veri: `open`
            // non ne ha uno, `activate` sì.
            weights: Arc::new(RwLock::new(FieldWeights::default())),
        })
    }

    /// Il capo dell'`Arc` da dare a [`SearchSettings`] perché possa rinfrescare
    /// i pesi di *questo* indice.
    ///
    /// Esiste perché i due si registrano separatamente — un `IndexProvider` e
    /// un `EventHandler` sono due registrazioni distinte, e dopo la prima
    /// l'indice è dentro il workspace e non lo si tocca più. Il capo si prende
    /// **prima**, al montaggio.
    pub fn settings_handler(&self) -> SearchSettings {
        SearchSettings {
            weights: Arc::clone(&self.weights),
        }
    }

    /// I pesi con cui questo indice sta punteggiando adesso. Per i test e le
    /// diagnostiche: una query non la si può interrogare su come ha pesato.
    pub fn weights(&self) -> FieldWeights {
        *self.weights.read().expect("rwlock")
    }

    /// Quanti documenti l'indice crede di avere. Utile ai test e alle
    /// diagnostiche; non è una query.
    pub fn len(&self) -> usize {
        self.fingerprints.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Apre un indice esistente, se c'è ed è ancora il nostro.
fn open_existing(dir: &Utf8Path, schema: &Schema) -> Option<Index> {
    if !dir.exists() {
        return None;
    }
    let index = Index::open_in_dir(dir).ok()?;
    // Lo schema sul disco deve essere identico a quello che il codice si
    // aspetta, altrimenti le query cercherebbero campi che non esistono.
    (index.schema() == *schema).then_some(index)
}

fn wipe(dir: &Utf8Path) -> Result<(), PluginError> {
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|and| io_err(dir, and))?;
    }
    Ok(())
}
