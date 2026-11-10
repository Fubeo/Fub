//! Lo store delle versioni: formato su disco (indice, metadati, piano),
//! ritenzione e le operazioni pubbliche di `VersionStore`.

use super::*;

pub(super) const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

pub(super) const INDEX_FILE: &str = "versions.json";
pub(super) const METADATA_FILE: &str = "meta.json";

pub(super) const MS_HOUR: u64 = 3_600_000;
pub(super) const MS_DAY: u64 = 24 * MS_HOUR;

/// Fasce di ritenzione (D6): sotto le 24 ore si tiene **tutto** (o una
/// versione per [`VERSIONING_INTERVAL_KEY`]), fino a una settimana una
/// versione all'ora, fino all'orizzonte una al giorno. L'orizzonte è
/// [`VERSIONING_RETENTION_KEY`], tre mesi di serie. Oltre, la storia recente —
/// quella che si ripesca davvero — è già al sicuro.
pub(super) const BAND_ALL: u64 = MS_DAY;
pub(super) const BAND_HOURLY: u64 = 7 * MS_DAY;
const RETENTION_DEFAULT_DAYS: u64 = 90;
#[cfg(test)]
pub(super) const BAND_DAILY: u64 = RETENTION_DEFAULT_DAYS * MS_DAY;

/// Ogni quanti minuti, al più, una versione nelle ultime 24 ore; `0` le tiene
/// tutte, ed è il default: è la forma che il versioning ha sempre avuto.
pub const VERSIONING_INTERVAL_KEY: &str = "versioning.interval";
/// Per quanti giorni si tiene la storia; `0` la tiene per sempre.
pub const VERSIONING_RETENTION_KEY: &str = "versioning.retention";
/// Un intervallo oltre il giorno non vuol dire niente: oltre le 24 ore decide
/// la fascia oraria.
const INTERVAL_MAX_MINUTES: f64 = 1440.0;
pub(super) const MS_MINUTE: u64 = 60_000;

/// Le due regolazioni della ritenzione.
///
/// **Non** `program_writable`, per la ragione di `backup.keep`: abbassarle
/// cancella versioni al salvataggio dopo, e un componente che potesse farlo da
/// sé potrebbe togliere di mezzo la storia su cui l'utente conta. Lo stesso
/// vale per [`VERSION_CLEAR`], che è un comando irreversibile e si conferma.
pub fn settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            VERSIONING_INTERVAL_KEY,
            Text::key(S_INTERVAL),
            SettingKind::Number {
                default: 0.0,
                min: Some(0.0),
                max: Some(INTERVAL_MAX_MINUTES),
            },
        )
        .describing(Text::key(S_INTERVAL_DESC))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::new(
            VERSIONING_RETENTION_KEY,
            Text::key(S_RETENTION),
            SettingKind::Number {
                default: RETENTION_DEFAULT_DAYS as f64,
                min: Some(0.0),
                max: None,
            },
        )
        .describing(Text::key(S_RETENTION_DESC))
        .grouped(Text::key(S_GROUP)),
    ]
}

/// La ritenzione letta adesso, in millisecondi.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Retention {
    /// Una versione per intervallo nelle ultime 24 ore; `0` le tiene tutte.
    pub(super) interval: u64,
    /// Oltre questa età una versione se ne va; `None` la tiene per sempre.
    pub(super) horizon: Option<u64>,
}

impl Retention {
    pub(super) fn read(host: &dyn ReadApi) -> Self {
        let number = |key: &str| host.setting(key).ok().and_then(|value| value.as_number());
        let minutes = number(VERSIONING_INTERVAL_KEY)
            .unwrap_or(0.0)
            .clamp(0.0, INTERVAL_MAX_MINUTES);
        let days = number(VERSIONING_RETENTION_KEY)
            .unwrap_or(RETENTION_DEFAULT_DAYS as f64)
            .max(0.0);
        Retention {
            interval: (minutes * MS_MINUTE as f64) as u64,
            horizon: (days > 0.0).then_some((days * MS_DAY as f64) as u64),
        }
    }
}

/// Il contenuto più grande che il versioning fotografa: 64 MiB.
///
/// Una fotografia tiene il file intero in memoria e lo ricopia nello store, e
/// dagli eventi lo fa mentre presta il workspace. Senza un tetto, un video da
/// qualche GB che compariva nel vault era un'allocazione di qualche GB e una
/// copia intera, con il vault fermo per tutto il tempo. Oltre il tetto un file
/// non ha versioni: la dimensione si chiede all'anagrafe, senza aprirlo, e
/// [`VersionStore::snapshot`] rifiuta comunque byte più lunghi. È la soglia
/// oltre la quale nemmeno il client tiene intera in memoria una risorsa.
pub const MAX_VERSION_BYTES: u64 = 64 * 1024 * 1024;

/// Una versione salvata.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionRef {
    /// Istante dello snapshot (millisecondi UNIX): è anche la sua identità.
    /// Resta un numero sul confine JSON: i millisecondi non arrivano a 2⁵³ e
    /// il frontend ci fa aritmetica (`new Date(ts)`).
    pub ts: u64,
    /// Impronta del contenuto, per il dedup (D6). È un u64 **pieno** (FNV su
    /// tutti i 64 bit) che si confronta per uguaglianza: sul confine JSON
    /// viaggia come stringa, o `JSON.parse` ne perderebbe i bit oltre 2⁵³ in
    /// silenzio — la regola è in `fub_abi::ipc`. In lettura il numero nudo
    /// resta accettato: gli indici persistiti prima della regola non si
    /// buttano.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub hash: u64,
    pub size: u64,
}

/// Le versioni di un documento, più il suo eventuale tombstone.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(super) struct DocVersions {
    /// Cartella dello store (nasce come impronta del `doc_id`, ma dopo un
    /// rename non lo è più: la chiave migra, la cartella resta dov'è).
    pub(super) dir: String,
    /// Quando il documento è stato cancellato, se lo è stato. È il tombstone:
    /// serve a sapere che a un certo istante quel file *non* c'era più.
    pub(super) deleted_at: Option<u64>,
    /// Dalla più vecchia alla più recente.
    pub(super) versions: Vec<VersionRef>,
}

/// L'indice **come si legge**: possiede i suoi documenti, perché chi lo legge
/// se li tiene.
#[derive(Deserialize)]
pub(super) struct Index {
    pub(super) schema_version: SchemaVersion,
    /// Le impronte che l'indice ricorda sono già nel `meta.json` di ogni
    /// cartella (vedi [`Inner::register_fingerprints`]). Manca negli indici
    /// scritti prima: vale `false`, e il primo `open` lo fa.
    #[serde(default)]
    registered: bool,
    pub(super) docs: BTreeMap<String, DocVersions>,
}

/// L'indice **come si scrive**: presta i documenti a chi li ha già.
///
/// Sono due tipi e non uno perché le due direzioni non hanno lo stesso
/// bisogno. Serializzando dall'[`Index`] posseduto, ogni scrittura cominciava
/// con un `docs.clone()` — una `BTreeMap` intera copiata, tutte le `String` e
/// tutti i `Vec`, per poi buttarla subito dopo. Il formato su disco è lo stesso
/// campo per campo: `#[serde(rename)]` non serve, perché i nomi dei campi
/// coincidono già.
///
/// `docs` è generico e non un `&BTreeMap` perché i due chiamanti hanno in mano
/// due cose diverse: [`VersionStore::in_lotto`] ha l'anagrafe viva, e
/// [`Inner::apply`] ha l'anagrafe viva **più un piano** che non è ancora
/// stato installato ([`PlanDocs`]).
#[derive(Serialize)]
pub(super) struct IndexToWrite<D: Serialize> {
    pub(super) schema_version: SchemaVersion,
    pub(super) registered: bool,
    pub(super) docs: D,
}

/// Che cosa una scrittura cambia nell'anagrafe: **le chiavi che tocca**.
///
/// È l'unità del piano, e ha due varianti perché una scrittura può far sparire
/// una chiave — [`VersionStore::rename`] la fa — e «assente dal piano» vuol già
/// dire «non toccata». Un `Option` le confonderebbe.
pub(super) enum Entry {
    /// Come sarà quel documento se il disco accetta.
    Present(DocVersions),
    /// Quel documento non ci sarà più.
    Removed,
}

/// Il piano: le sole chiavi toccate, con ciò che diranno.
///
/// **Non** è una copia dell'anagrafe. Lo era: ogni scrittura cominciava con un
/// `docs.clone()`, cioè copiava la mappa che nomina *tutti* i documenti del
/// vault per cambiarne una voce sola, e questo rendeva ogni fotografia
/// proporzionale al vault intero — quadratico nella passata di apertura (3,5 s
/// su 5 000 note, 79 s su 20 000) e lineare in ogni salvataggio a vault aperto
/// (8,5 ms contro 0,09 ms su 16 000 note, sotto il prestito esclusivo). Quel
/// che serviva davvero della copia non era la mappa: era **non installare
/// niente finché il disco non ha accettato**, e per quello basta un elenco di
/// una chiave (due nel rename). Vedi [`Inner::apply`], dove la disciplina è
/// scritta per intero.
pub(super) type Plan = BTreeMap<String, Entry>;

/// Il piano di una chiave sola: la forma di tutte le scritture tranne il
/// rename.
fn plan_of(id: &DocId, doc: DocVersions) -> Plan {
    Plan::from([(id.to_string(), Entry::Present(doc))])
}

/// L'anagrafe **come sarà** se il disco accetta il piano, senza costruirla.
///
/// Serve a scrivere `versions.json`, che nomina tutti i documenti e quindi
/// costa O(N) byte per definizione: il punto non è scrivere di meno, è non
/// **copiare** N voci per scriverne N. Le due mappe sono ordinate sulla stessa
/// chiave, quindi si fondono scorrendole in parallelo, e ciò che il piano
/// dichiara [`Voce::Tolta`] semplicemente non esce.
pub(super) struct PlanDocs<'a> {
    pub(super) live: &'a BTreeMap<String, DocVersions>,
    pub(super) plan: &'a Plan,
}

impl Serialize for PlanDocs<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        // La lunghezza non si dichiara perché non si conosce senza contare, e
        // contare vorrebbe dire scorrere due volte: JSON non ne ha bisogno.
        let mut map = serializer.serialize_map(None)?;
        let mut live = self.live.iter().peekable();
        let mut touched = self.plan.iter().peekable();
        loop {
            let order = match (live.peek(), touched.peek()) {
                (None, None) => break,
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some((live, _)), Some((touched, _))) => live.as_str().cmp(touched.as_str()),
            };
            if order == std::cmp::Ordering::Less {
                let (key, doc) = live.next().expect("c'è, l'ho appena guardato");
                map.serialize_entry(key, doc)?;
                continue;
            }
            // Il piano ha l'ultima parola sulla chiave che nomina: se è anche
            // viva, la voce viva si salta.
            if order == std::cmp::Ordering::Equal {
                live.next();
            }
            let (key, entry) = touched.next().expect("c'è, l'ho appena guardato");
            if let Entry::Present(doc) = entry {
                map.serialize_entry(key, doc)?;
            }
        }
        map.end()
    }
}

/// Ciò che una cartella dello store dice di sé. Basta a ricostruire l'indice.
#[derive(Serialize, Deserialize)]
pub(super) struct Meta {
    pub(super) doc_id: String,
    pub(super) deleted_at: Option<u64>,
    /// Le impronte **registrate** di ogni versione della cartella, scritte
    /// quando la versione nasce. Sono ciò che rende la ricostruzione
    /// dell'indice un confronto e non un'autocertificazione: un blob alterato
    /// dopo la sua scrittura non si fa passare per sano ricalcolandogli
    /// l'impronta. Manca nelle cartelle scritte prima che esistesse (e
    /// `#[serde(default)]` le legge lo stesso): lì la ricostruzione ricalcola
    /// dai byte, come faceva, e il primo salvataggio le registra.
    #[serde(default)]
    pub(super) versions: Vec<VersionRef>,
}

/// Che cosa una cartella dello store **rivendica**, e i due modi diversi in cui
/// può non dirlo.
///
/// I due modi sono un tipo e non un `Option` perché non vogliono dire la stessa
/// cosa e nessun chiamante li tratta allo stesso modo: una cartella senza
/// `meta.json` non è di nessuno, una col `meta.json` illeggibile è di qualcuno
/// che non sappiamo nominare. Schiacciarli su `None` — un `.ok()` — faceva dire
/// a [`Inner::dir_for`] «libera» di una cartella piena, e a quel punto la prima
/// [`write_metadata`] ci scriveva sopra il nome di un altro documento.
pub(super) enum Claim {
    /// Nessun `meta.json`: la cartella non è di nessuno.
    None,
    /// Un `meta.json` c'è e non si legge. **Non** è una cartella libera.
    Unreadable,
    /// La cartella dice di chi è.
    Owned(Meta),
}

pub(super) struct Inner {
    pub(super) docs: BTreeMap<String, DocVersions>,
    /// C'è un lotto aperto ([`VersionStore::in_lotto`])?
    ///
    /// Dentro un lotto [`Inner::apply`] scrive il `meta.json` — che è
    /// l'autorità — e **non** l'indice, che è il derivato e si compone in fondo
    /// una volta sola. Il flag sta qui e non nel chiamante perché la regola
    /// deve valere per **ogni** strada che passa da `apply`: chi domani
    /// aggiungesse un `VersioningHandler::sweep` chiamato dentro una passata la
    /// eredita senza saperlo, e un lotto che valesse solo per `snapshot`
    /// riscriverebbe di nuovo l'indice a ogni tombstone della riconciliazione.
    pub(super) batch: bool,
    /// Il `meta.json` di ogni cartella ha già le impronte delle sue versioni?
    /// Lo dice l'indice ([`Index::registered`]) e lo riscrive com'è.
    pub(super) registered: bool,
}

/// Lo store delle versioni.
///
/// Clonabile e condiviso: una copia vive dentro il [`VersioningHandler`]
/// registrato nel workspace, l'altra resta all'app, che deve poter elencare e
/// rileggere le versioni senza passare dagli eventi. Ciò che l'app **non** ha
/// più è un canale privilegiato: anche lei passa da un `HostApi`
/// (`Workspace::with_host`), lo stesso che riceve l'handler.
#[derive(Clone)]
pub struct VersionStore {
    /// **Il prestito attraversa il disco nelle scritture, e non nelle letture**,
    /// e la riga fra le due non è dove sta l'I/O: è cosa succede se qualcuno
    /// entra in mezzo.
    ///
    /// [`Inner::apply`] costruisce il piano da ciò che `docs` dice *adesso* e
    /// lo installa solo se il disco l'ha accettato: mollare il prestito in
    /// mezzo darebbe a due salvataggi la stessa base, e il secondo cancellerebbe
    /// il primo senza che nessuno dei due se ne accorga. Là il prestito che
    /// attraversa il `data_write` **è** l'atomicità, non un difetto, e togliere
    /// l'I/O da sotto spezzerebbe questa proprietà e confonderebbe il confine
    /// fra lettura e scrittura.
    ///
    /// In lettura no: quello che serve è il path, e [`Inner::path`] lo
    /// consegna con la guardia già finita. Vedi [`VersionStore::read`].
    pub(super) inner: Arc<Mutex<Inner>>,
}

impl VersionStore {
    /// Apre (o crea) lo store nello spazio dati del plugin.
    pub fn open(host: &mut dyn HostApi) -> Result<Self, PluginError> {
        let (docs, registered, from_index) = match load_index(host) {
            Some(index) => (index.docs, index.registered, true),
            None => {
                let rebuilt = rebuild_from_store(host)?;
                if !rebuilt.is_empty() {
                    // Ripubblica il derivato quando possibile. Se il cache non
                    // si può scrivere, i lettori ricostruiscono dagli snapshot.
                    if let Err(error) = write_index(&rebuilt, true, host) {
                        host.emit(Event::Trouble {
                            severity: Severity::Warning,
                            subject: None,
                            error,
                            gate: None,
                        });
                    }
                    tracing::info!(
                        target: "fub.versioning",
                        "indice assente o illeggibile, ricostruito dallo store \
                         ({} document{})",
                        rebuilt.len(),
                        if rebuilt.len() == 1 { "o" } else { "i" }
                    );
                }
                // Un indice ricostruito dai byte non ha impronte che valga la
                // pena registrare: le ha ricalcolate lui, e metterle nel
                // `meta.json` le farebbe passare per quelle della scrittura.
                (rebuilt, true, false)
            }
        };
        let mut inner = Inner {
            docs,
            batch: false,
            registered,
        };
        if from_index && !registered {
            inner.register_fingerprints(host);
        }
        Ok(VersionStore {
            inner: Arc::new(Mutex::new(inner)),
        })
    }

    /// Una passata su **molti** documenti, con l'indice scritto una volta sola.
    ///
    /// # Perché esiste
    ///
    /// `versions.json` è un file solo che nomina tutti i documenti, quindi
    /// scriverlo costa O(N) byte *sempre*, anche per una versione sola. Fuori da
    /// una passata quel costo è il prezzo onesto di un indice; dentro una
    /// passata su N note diventa N indici di taglia crescente — **O(N²) byte**,
    /// e su 2 000 note misurate erano 267 MB scritti per un indice finale da
    /// 267 KB. Non è una costante da limare: è la classe sbagliata.
    ///
    /// # Perché non è un baratto fra velocità e durabilità
    ///
    /// L'indice si **toglie** prima di cominciare, invece di lasciarlo lì
    /// vecchio. È la differenza fra le due forme, ed è tutta la differenza:
    ///
    /// - un indice **vecchio** dopo un crash è un derivato che si crede la
    ///   verità, e le fotografie della passata interrotta — blob e `meta.json`
    ///   già sul disco — resterebbero senza nessuno che le nomina, per sempre;
    /// - un indice **assente** è esattamente la condizione che
    ///   [`VersionStore::open`] sa gestire da sempre: ricostruisce dallo store,
    ///   dove ogni cartella dice di chi è e ogni file dice quando. Non si perde
    ///   niente.
    ///
    /// Il verso della durabilità quindi non peggiora, **migliora**: con l'indice
    /// scritto a ogni fotografia, un processo ucciso fra il blob e l'indice
    /// lasciava quel blob orfano e invisibile. Qui no.
    ///
    /// Il prezzo vero, e sta scritto per non riscoprirlo: dopo un'interruzione
    /// la riapertura paga una ricostruzione, che legge tutti gli snapshot. Si
    /// paga una volta, dopo un crash, e la direzione dell'errore è il tempo —
    /// mai una versione persa.
    ///
    /// # Cosa non cambia
    ///
    /// Quali fotografie esistono, in che ordine, e il contenuto dell'indice che
    /// ne esce: identico byte per byte a quello che sarebbe uscito riscrivendolo
    /// ogni volta, perché è la stessa funzione sullo stesso `docs` finale.
    ///
    /// Durante il lotto l'indice è assente. I lettori ricostruiscono la vista
    /// dagli snapshot già persistiti: vedono il progresso durevole, senza
    /// interpretare l'indice mancante come una cronologia vuota.
    pub(super) fn in_batch<T>(
        &self,
        host: &mut dyn HostApi,
        pass: impl FnOnce(&mut dyn HostApi) -> T,
    ) -> Result<T, PluginError> {
        // Se togliere l'indice non riesce, la passata **non comincia**: andare
        // avanti vorrebbe dire lasciare sul disco esattamente l'indice vecchio
        // che questa forma esiste per non lasciare. E un `data_remove` che
        // fallisce su uno spazio dati è lo stesso guasto per cui fallirebbe
        // ogni `data_write` che segue.
        host.data_remove(INDEX_FILE)?;
        self.inner.lock().expect("mutex").batch = true;
        let batch_guard = Batch { inner: &self.inner };
        let result = pass(&mut *host);
        drop(batch_guard);
        // Il prestito attraversa il `data_write` come lo attraversa in
        // [`Inner::apply`], e per la stessa ragione: l'indice che va sul disco
        // dev'essere quello che `docs` dice *adesso*. Mollandolo in mezzo, un
        // salvataggio che entrasse qui scriverebbe il suo indice e poi questo ci
        // scriverebbe sopra il proprio, più vecchio di una versione.
        let inner = self.inner.lock().expect("mutex");
        write_index(&inner.docs, inner.registered, host)?;
        Ok(result)
    }

    /// Salva una versione, se il contenuto è diverso dall'ultima salvata.
    ///
    /// Restituisce `None` quando il dedup (D6) ha deciso che non c'era niente
    /// di nuovo: è il caso normale del salvataggio che riscrive gli stessi byte.
    /// `None` anche per un contenuto oltre [`MAX_VERSION_BYTES`], che non ha
    /// versioni.
    pub fn snapshot(
        &self,
        id: &DocId,
        source: &[u8],
        host: &mut dyn HostApi,
    ) -> Result<Option<VersionRef>, PluginError> {
        if source.len() as u64 > MAX_VERSION_BYTES {
            tracing::info!(target: "fub.versioning", "{id} supera il tetto delle versioni: non si fotografa");
            return Ok(None);
        }
        let mut inner = self.inner.lock().expect("mutex");
        let hash = Fnv1a::hash(source);
        let dir_doc = inner.dir_for(id, host)?;

        if let Some(doc) = inner.docs.get(id.as_str()) {
            if doc.versions.last().is_some_and(|v| v.hash == hash) {
                // Niente di nuovo da salvare — ma ci hanno chiesto di
                // fotografare una nota VIVA: se portava un tombstone
                // (cestinata e ripristinata con lo stesso identico contenuto)
                // il tombstone se ne va comunque, o "il vault al tempo T" la
                // crederebbe cancellata per sempre.
                if doc.deleted_at.is_some() {
                    let mut restored = doc.clone();
                    restored.deleted_at = None;
                    inner.apply(plan_of(id, restored), id, host)?;
                }
                return Ok(None);
            }
        }

        let ts = inner.free_ts(id, host);
        host.data_write(&blob(&dir_doc, &snapshot_name(ts, id.as_str())), source)?;

        let version = VersionRef {
            ts,
            hash,
            size: source.len() as u64,
        };
        let mut doc = inner.docs.get(id.as_str()).cloned().unwrap_or_default();
        doc.dir = dir_doc;
        doc.versions.push(version);
        // Una nota che torna in vita non è più morta: il tombstone se ne va, o
        // "il vault al tempo T" la crederebbe cancellata per sempre.
        doc.deleted_at = None;

        // La potatura decide **prima** e cancella **dopo**: `prune` tocca solo
        // l'elenco del piano e dice quali contenuti avanzano, l'indice va sul
        // disco, e solo un indice già scritto autorizza a togliere i blob. Se
        // `apply` fallisce si esce di qui con tutti i contenuti al loro posto
        // e un indice vecchio che li nomina tutti: si perde la potatura, non
        // una versione. Stessa forma di `rename`, stessa ragione di `relocate`
        // — vedi il commento là.
        let pruned = prune(&mut doc, id, host);
        inner.apply(plan_of(id, doc), id, host)?;
        if !pruned.is_empty() {
            tracing::info!(
                target: "fub.versioning",
                "{} version{} di {id} potate dalle fasce di ritenzione",
                pruned.len(),
                if pruned.len() == 1 { "e" } else { "i" }
            );
        }
        sweep(&pruned, host);
        Ok(Some(version))
    }

    /// Migra le versioni sul nuovo path: l'identità di un documento **è** il
    /// suo path, e un rename la sposta senza spezzare la storia.
    ///
    /// Migra anche i **contenuti**, non solo l'indice. [`VersionStore::read`]
    /// interroga due sorgenti diverse — all'indice chiede se una versione
    /// esiste, al disco cosa contiene — e l'unico modo perché non si
    /// contraddicano è che la storia unita finisca tutta sotto una cartella
    /// sola, coi nomi che `read` andrà davvero a cercare.
    /// Quante note hanno una cronologia, e quante versioni in tutto.
    pub fn census(&self) -> (usize, usize) {
        let inner = self.inner.lock().expect("mutex");
        let versions = inner.docs.values().map(|doc| doc.versions.len()).sum();
        (inner.docs.len(), versions)
    }

    /// **Svuota la cronologia del vault intero**: versioni e tombstone di ogni
    /// documento. Le note non si toccano. Restituisce quanti documenti e quante
    /// versioni se ne sono andati.
    ///
    /// L'ordine è quello che rende innocua ogni interruzione:
    ///
    /// 1. l'indice se ne va per primo, come in [`VersionStore::in_batch`]: un
    ///    indice assente è la condizione da cui [`VersionStore::open`]
    ///    ricostruisce, uno vecchio sarebbe un derivato che si crede la verità;
    /// 2. ogni cartella smette di dire di chi è (`meta.json`, l'autorità). Una
    ///    ricostruzione a questo punto salta le cartelle già liberate e ritrova
    ///    intere le altre: la cronologia è svuotata a metà, mai mescolata;
    /// 3. l'indice torna, con ciò che resta;
    /// 4. solo allora i contenuti se ne vanno, compresi gli orfani che nessun
    ///    indice nominava più. Una cartella senza `meta.json` non è di nessuno,
    ///    e toglierne i blob non rompe nessuna lettura.
    ///
    /// Il prestito attraversa il disco per tutto il giro, per la ragione di
    /// [`Inner::apply`]: un salvataggio che entrasse in mezzo scriverebbe il suo
    /// indice sopra quello che si sta svuotando.
    pub fn clear(&self, host: &mut dyn HostApi) -> Result<(usize, usize), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        host.data_remove(INDEX_FILE)?;
        let mut released: Vec<String> = Vec::new();
        let mut failure = None;
        for (key, doc) in &inner.docs {
            if !doc.dir.is_empty() {
                if let Err(error) = host.data_remove(&blob(&doc.dir, METADATA_FILE)) {
                    failure = Some(error);
                    break;
                }
            }
            released.push(key.clone());
        }
        let mut dirs: Vec<String> = Vec::new();
        let mut versions = 0;
        for key in &released {
            if let Some(doc) = inner.docs.remove(key) {
                versions += doc.versions.len();
                if !doc.dir.is_empty() {
                    dirs.push(doc.dir);
                }
            }
        }
        // Se l'indice non torna, resta assente: chi legge ricostruisce dalle
        // cartelle che dicono ancora di chi sono, cioè da ciò che resta. Per
        // questo i contenuti liberati si tolgono comunque.
        let index = write_index(&inner.docs, inner.registered, host);
        for dir in &dirs {
            match host.data_list(dir) {
                Ok(paths) => sweep(&paths, host),
                Err(and) => {
                    tracing::warn!(target: "fub.versioning", "{dir} non si elenca, i suoi contenuti restano: {and}");
                }
            }
        }
        drop(inner);
        tracing::info!(
            target: "fub.versioning",
            "cronologia svuotata: {versions} version{} di {} document{}",
            if versions == 1 { "e" } else { "i" },
            released.len(),
            if released.len() == 1 { "o" } else { "i" }
        );
        if let Some(error) = failure {
            return Err(error);
        }
        index?;
        Ok((released.len(), versions))
    }

    pub fn rename(
        &self,
        from: &DocId,
        to: &DocId,
        host: &mut dyn HostApi,
    ) -> Result<(), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let Some(doc) = inner.docs.get(from.as_str()).cloned() else {
            return Ok(());
        };
        // Se il nuovo nome aveva già una storia (una nota cestinata, il cui
        // path viene rioccupato, e che si ripristina sotto un altro nome), le
        // due si uniscono in ordine di tempo: buttarne una sarebbe perdere
        // versioni senza dirlo.
        let existing = inner.docs.get(to.as_str()).cloned();
        let relocation = relocate(&doc, from, existing.as_ref(), to, host)?;
        // Da qui l'indice si muove, e si muove su contenuti già al loro posto.
        // Le due sole chiavi che cambiano. L'ordine dei due `insert` conta se
        // `from` e `to` coincidono — un rename di solo caso su un filesystem
        // che non lo distingue: là la chiave resta, con la storia unita.
        let mut plan = Plan::new();
        plan.insert(from.to_string(), Entry::Removed);
        plan.insert(to.to_string(), Entry::Present(relocation.doc));
        inner.apply(plan, to, host)?;
        // Ultimo ciò che resta indietro: è spazio sprecato, non una bugia, e
        // non vale la pena di far fallire un rename già andato a buon fine.
        sweep(&relocation.to_remove, host);
        Ok(())
    }

    /// Segna che il documento, a questo istante, non c'è più.
    ///
    /// **Non sposta un tombstone già posato**: l'istante della morte è un fatto,
    /// e la riconciliazione dopo un `Overflow` ripassa sulle stesse chiavi. Una
    /// nota che risorge perde il tombstone in [`VersionStore::snapshot`], che è
    /// il solo posto dove può tornare viva.
    pub fn tombstone(&self, id: &DocId, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let now = host.now_unix_millis();
        let Some(doc) = inner.docs.get(id.as_str()) else {
            return Ok(());
        };
        if doc.deleted_at.is_some() {
            return Ok(());
        }
        let mut deleted = doc.clone();
        deleted.deleted_at = Some(now);
        inner.apply(plan_of(id, deleted), id, host)
    }

    /// Questo documento risulta cancellato?
    pub fn is_deleted(&self, id: &DocId) -> bool {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .is_some_and(|d| d.deleted_at.is_some())
    }

    /// Le versioni di un documento, dalla più recente alla più vecchia.
    ///
    /// Non serve l'host: l'elenco è in memoria, e l'unica cosa che sta su disco
    /// è il contenuto ([`VersionStore::read`]).
    pub fn list(&self, id: &DocId) -> Vec<VersionRef> {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .map(|d| d.versions.iter().rev().copied().collect())
            .unwrap_or_default()
    }

    /// Il contenuto di una versione.
    ///
    /// **Prende un [`ReadApi`] e non un `HostApi`**, ed è la riga per cui questa
    /// firma è più stretta del necessario apposta: leggere una versione è una
    /// lettura, e chi la serve deve poterlo fare dal prestito **condiviso** del
    /// workspace (`Workspace::with_read_host`, decisione 0024). **Non è un
    /// presidio**, e va detto perché la cosa ovvia è sbagliata: un
    /// `&mut dyn HostApi` si converte da sé in un `&dyn ReadApi`, che ne è la
    /// supertrait, quindi questa firma non chiude nessuna porta. È la
    /// dichiarazione di cosa questa funzione fa, e serve a chi la chiama per
    /// sapere quale dei due prestiti le basta.
    ///
    /// **E il lucchetto dello store non attraversa il disco.** Il prestito serve
    /// a sapere *dove* sta il blob — cioè a leggere l'anagrafe in memoria — e
    /// e quello finisce con [`Inner::path`], che è l'unica a vederlo. Da qui
    /// in giù non c'è nessuna guardia da tenere: la lettura del blob è di chi ha
    /// il path.
    pub fn read(&self, id: &DocId, ts: u64, host: &dyn ReadApi) -> Result<String, PluginError> {
        let (path, version) = self.inner.lock().expect("mutex").path(id, ts)?;
        let bytes = read_snapshot(&path, version, host)?;
        String::from_utf8(bytes).map_err(|and| {
            PluginError::Internal(Text::message(
                UNREADABLE,
                vec![Arg::text(PATH, path), Arg::text(REASON, and.to_string())],
            ))
        })
    }

    /// Questo documento ha già una storia?
    ///
    /// Serve alla **prima fotografia** del vault (vedi
    /// [`VersioningHandler`]): chi ha già una storia non paga nulla, nemmeno
    /// una lettura.
    pub fn has_versions(&self, id: &DocId) -> bool {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .is_some_and(|d| !d.versions.is_empty())
    }

    /// Lo store conserva qualcosa per questo documento?
    pub fn holds(&self, id: &DocId) -> bool {
        self.inner
            .lock()
            .expect("mutex")
            .docs
            .contains_key(id.as_str())
    }

    /// I documenti di cui lo store conserva qualcosa. Utile alle diagnostiche e
    /// (in una seconda passata) alla vista "vault al tempo T".
    pub fn documents(&self) -> Vec<DocId> {
        let inner = self.inner.lock().expect("mutex");
        inner.docs.keys().map(DocId::new).collect()
    }
}
