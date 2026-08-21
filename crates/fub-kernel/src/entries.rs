//! **L'anagrafe resa durevole**: `.fub/data/entries.json`, cioè ciò che il
//! kernel sapeva del vault l'ultima volta che l'ha guardato (§14.1, §14.2).
//!
//! # Cosa ci sta dentro, e perché
//!
//! Per ogni file: dimensione, data, l'impronta se qualcuno ne ha già avuto i
//! byte in mano, e — per i soli documenti — i **metadati** che il kernel avrebbe
//! dovuto riaprire e riparsare il file per riavere (frontmatter, outline, link,
//! tag). Non è un secondo indice: è la stessa cache di metadati che il kernel
//! tiene in memoria, scritta invece che buttata. Senza di essa `reindex`
//! rileggeva e riparsava **l'intero vault a ogni apertura**, e lo faceva prima
//! ancora di chiedere agli indici se gli interessava.
//!
//! # È un dato DERIVATO, e qui è tutto
//!
//! Sta sotto [`data_root`], che è la radice di ciò che si può buttare, e la
//! disciplina segue da lì:
//!
//! - **illeggibile o di una versione che non si conosce → si butta e si
//!   ricostruisce**, senza un avviso e senza bloccare niente. È l'opposto di
//!   [`crate::organization`], che di fronte a un file che non ha potuto leggere
//!   si rifiuta di sovrascriverlo: quello è **autorevole** — perso, non si
//!   ricostruisce da niente — e questo no. Buttare questa tabella costa una
//!   riapertura lenta, cioè esattamente il comportamento che c'era prima che
//!   esistesse;
//! - la **versione di schema** c'è dal primo giorno (§15.3). Non perché serva a
//!   migrare — un derivato non si migra, si rifà — ma perché senza un numero in
//!   testa la versione dopo dovrebbe *indovinare* che un file senza campo viene
//!   da prima;
//! - la scrittura è **incrementale** (difetto 0112): il file è una coda di
//!   record, ognuno su una riga che si delimita da sé (`\n{…}\n`, lo stesso
//!   formato del [`crate::journal`], §15.7), e cambiare una voce su N appende
//!   il solo record di quel cambiamento invece di riscrivere la tabella intera.
//!   L'atomicità della
//!   [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)
//!   qui non c'è, e non serve: un file mezzo scritto ha una riga rotta in coda,
//!   e una riga rotta si scarta — un derivato che si ricostruisce non ha
//!   bisogno che la sua scrittura sia «o c'è o non c'è», ha bisogno che chi
//!   legge sappia cosa non ha letto. La **compattazione** — l'unica riscrittura
//!   integrale, quando la coda supera [`TETTO`] record o quando non c'è una
//!   coda da cui partire — passa da
//!   [`VaultStorage::update_derived`](crate::storage::VaultStorage::update_derived),
//!   che fonde sotto lucchetto e poi scrive **senza `fsync`**: un crash può
//!   lasciare la coda troncata o assente, e troncata o assente si ricostruisce,
//!   che è la riga sopra. È la stessa distinzione della
//!   [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)
//!   portata alla classe che lei non conosceva: per i **documenti** la promessa
//!   «o c'è o non c'è» vale e si paga, per un derivato il `fsync` comprerebbe
//!   una riapertura lenta in meno a ogni chiusura del vault — e il suo prezzo
//!   si paga a ogni chiusura del vault.
//!
//! La classe («derivato o autorevole») non è ancora dicibile nel contratto: è il
//! §15.4, che è P0 come *scelta della forma* e che questa voce non chiude. Ciò
//! che questa voce evita è di far nascere il posto nuovo **indovinando per
//! imitazione**: la classe è quella della radice in cui sta, ed è scritta qui.
//!
//! # Perché la specie NON si persiste
//!
//! Perché non è una proprietà del file. Un `.canvas` è
//! [`EntryKind::Unknown`](fub_abi::traits::EntryKind::Unknown) oggi e
//! `Document` il giorno che qualcuno rivendica quell'estensione, senza che il
//! file sia cambiato: una specie scritta su disco sopravvivrebbe alla
//! registrazione del provider e direbbe la cosa sbagliata. Si ricalcola a ogni
//! apertura, e costa il confronto di un'estensione.
//!
//! # La data che mente, e la regola di git
//!
//! `mtime + size` è il criterio con cui si riconosce l'immutato, ed è il criterio
//! di git, di rsync e di make. Sbaglia in due versi che non costano uguale: un
//! falso «cambiato» costa una rilettura, un falso «immutato» costa un indice
//! fermo su un documento vecchio. Il caso in cui il secondo capita davvero è la
//! scrittura che avviene **nello stesso istante** in cui si scrive questa
//! tabella: un file salvato mentre la scansione lo guardava porterebbe una data
//! che combacia e un contenuto che non combacia più.
//!
//! Da lì la regola che git chiama *racily clean*: una data che non è
//! **strettamente** nel passato rispetto al momento in cui la si è letta non si
//! crede mai, perché quel file può essere cambiato ancora dentro lo stesso
//! millisecondo, dopo che l'abbiamo guardato e senza che la data se ne accorga.
//!
//! Il *momento in cui la si è letta* è quello della **scansione**, e per un po'
//! qui è stato quello della scrittura di questa tabella (difetto 0187). Sono
//! due istanti diversi e in mezzo ci sta una sessione intera: l'anagrafe si
//! scrive alla fine dell'indicizzazione e alla chiusura del vault, mentre le
//! date che porta dentro sono state lette quando ognuno di quei file è passato
//! sotto la `stat` — all'apertura per la scansione, o più tardi per mano del
//! rilevatore. Con la soglia sulla scrittura, un file cambiato **nel proprio
//! istante di osservazione** ricadeva sotto la soglia — la scrittura viene
//! sempre dopo — e la tabella lo dichiarava pulito con dentro il contenuto di
//! prima: l'indice restava fermo su una versione vecchia fino al primo evento
//! che tornasse a toccare quel file, e se nessuno lo toccava, per sempre.
//!
//! La soglia quindi non è più una sola per tutta la tabella, e nemmeno un
//! numero scritto sul disco: la domanda si pone **dove si osserva**, una voce
//! per volta, e la risposta è un sì o un no che non ha bisogno di essere
//! confrontato con niente più tardi. Una voce la cui data non è nel passato al
//! momento in cui la si mette in anagrafe è *racily clean*, e non si scrive:
//! chi riapre non la trova e la rilegge, che è il costo di sempre — la
//! rilettura dei pochi file toccati nel proprio millisecondo — pagato però nel
//! caso giusto invece che in nessuno.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::model::{Anchor, DocId, Frontmatter, Heading, Link};
use serde::{Deserialize, Serialize};

use crate::storage::{Durable, VaultStorage};
use crate::vault::data_root;
use fub_abi::schema::SchemaVersion;

/// La versione di schema del file (§15.3).
///
/// A differenza del sidecar dell'organizzazione, qui **non** si legge un file
/// senza versione come «versione 0»: questo formato nasce con il campo, quindi
/// un file che non ce l'ha non è un file di prima — è un file di qualcun altro.
///
/// v2: `stored-meta.anchors` (decisione 0049). Un campo `#[serde(default)]`
/// avrebbe letto i file di prima senza rompersi, ed è precisamente il motivo
/// per cui non basta: un vault riaperto da una tabella v1 avrebbe zero ancore e
/// nessun modo di dirlo, quindi `[[Nota#^blocco]]` sarebbe tornato ad aprire la
/// nota in cima — la §21.10 riaperta dalla cache dopo essere stata chiusa nella
/// firma. Un derivato di una versione che non si conosce si rifà, e qui il
/// costo è una riapertura lenta sola.
///
/// v3: via `written_at` (difetto 0187). La soglia *racily clean* non è più un
/// numero in testa alla tabella ma una domanda posta a ogni voce nel momento in
/// cui la si osserva, quindi il campo non ha più niente da dire — e leggerlo
/// senza applicarlo sarebbe peggio che non averlo. Una tabella v2 non si
/// converte: le sue voci sono state vagliate con la soglia sbagliata, e
/// fidarsene vorrebbe dire portarsi dentro il difetto una riapertura più in là.
///
/// v4: la coda di record (difetto 0112). La tabella intera si riscriveva a ogni
/// voce cambiata, e su un vault grande il prezzo si pagava a ogni salvataggio.
/// Il file diventa una coda di [`Mutazione`] — `upsert`, `remove`, `snapshot` —
/// e la riscrittura integrale resta solo per la compattazione. Un file v3 non
/// si converte: non comincia con `\n`, quindi [`decodifica`] risponde `None` e
/// il primo [`EntryStore::store`] lo sostituisce con una fotografia — la regola
/// di sempre, «un derivato di una versione che non si conosce si rifà».
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(4);

/// Il nome del file dentro [`data_root`].
const FILE: &str = "entries.json";

/// Quanti record si tengono prima di compattare, come il tetto del
/// [`crate::journal`]. La coda resta così sotto qualche megabyte — sempre meno
/// della fotografia di un vault grande, che è ciò che la compattazione
/// riscriverebbe — e la compattazione stessa, che è l'unica riscrittura
/// integrale, capita una volta ogni diecimila cambiamenti e non a ogni
const CEILING: usize = 10_000;

/// salvataggio.
/// Una mutazione della tabella, come sta su una riga del file.
///
/// Internally-tagged su `op` perché la riga si legga a colpo d'occhio:
/// `{"v":4,"op":"upsert","id":"a.md","entry":{…}}`. Generica sul solo campo
/// che pesa, come lo era [`EntriesFile`]: la compattazione scrive
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Mutation<E = BTreeMap<DocId, StoredEntry>> {
/// `Snapshot { entries: &tabella }` senza copiare la tabella intera.
    /// Una voce nuova o cambiata: si mette al suo posto, coprendo ciò che c'era.
    /// Il payload sta in un `Box` perché chi porta solo un `Remove` non deve
    /// pagare il posto di [`StoredEntry`] — e serde lo attraversa, quindi
    Upsert { id: DocId, entry: Box<StoredEntry> },
    /// la riga su disco non cambia di un byte.
    Remove { id: DocId },
    /// Una voce sparita: si toglie, se c'è.
    /// La fotografia intera: azzera la tabella e la sostituisce. È il record
    Snapshot { entries: E },
}

    /// della compattazione, e il primo record di un file che nasce.
/// Un record del file: la versione di schema e la mutazione.
///
/// Generico come [`Mutazione`], per la stessa ragione: la compattazione
#[derive(Serialize, Deserialize)]
struct Record<E = BTreeMap<DocId, StoredEntry>> {
    v: SchemaVersion,
    #[serde(flatten)]
    mutation: Mutation<E>,
}

/// serializza `Snapshot { entries: &tabella }` senza copiare la tabella.
/// I metadati di un documento che l'anagrafe si ricorda: ciò che il kernel
/// avrebbe dovuto **rileggere e riparsare** il file per riavere.
///
/// Il **corpo** non c'è, come non c'è nella cache in memoria (`DocMeta`) e per
/// la stessa ragione: il render lo riparsa dal disco su richiesta, e tenerlo qui
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct StoredMeta {
    #[serde(default)]
    pub(crate) frontmatter: Frontmatter,
    #[serde(default)]
    pub(crate) outline: Vec<Heading>,
    #[serde(default)]
    pub(crate) links: Vec<Link>,
/// vorrebbe dire scrivere l'intero vault una seconda volta accanto a sé stesso.
    /// Le ancore di blocco (`^abc`), con lo span del blocco che le porta.
    ///
    /// Portano uno span come gli [`Heading`] dell'outline, e per la stessa
    /// ragione è lecito scriverlo: questa tabella si crede solo finché
    /// dimensione e data dicono che il file non è cambiato, quindi lo span è
    /// ancora quello del sorgente che c'è. È la differenza con i tag, di cui si
    /// scrivono i soli nomi.
    ///
    /// Ci sono dalla decisione 0049: senza, dopo un'apertura veloce
    /// `[[Nota#^blocco]]` saprebbe dire *quale* documento e non *dove dentro* —
    #[serde(default)]
    pub(crate) anchors: Vec<Anchor>,
    /// cioè il buco della §21.10 riaperto dalla cache invece che dalla firma.
    /// I tag **come la nota li scrive** (`#Rust`, non `rust`): è ciò che
    /// [`TagCounts`](crate::tag_counts::TagCounts) prende in ingresso, e
    /// riscriverli in forma canonica farebbe sparire la grafia dal pannello dei
    /// tag alla prima riapertura.
    ///
    /// I nomi e non i [`Tag`](fub_abi::model::Tag) interi: un `Tag` porta lo
    /// **span**, che è una posizione dentro un sorgente che qui non c'è. Uno
    #[serde(default)]
    pub(crate) tags: Vec<String>,
}

    /// span inventato sarebbe un dato falso scritto su disco.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct StoredEntry {
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fingerprint: Option<Revision>,
/// Una voce come sta sul file.
    /// Assente per ciò che non è un documento: un PNG non ha un modello, e
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) metadata: Option<StoredMeta>,
}

impl StoredEntry {
    /// nessuno lo riparsa.
    /// Questa voce descrive ancora il file che la scansione ha trovato?
    ///
    /// Dimensione **e** data: la dimensione da sola cambia raramente per una
    /// modifica vera (una parola sostituita con un'altra della stessa
    pub(crate) fn describes(&self, size: u64, mtime: u64) -> bool {
        self.size == size && self.mtime == mtime
    }
}

    /// lunghezza), la data da sola cambia anche quando il contenuto non cambia.
pub(crate) struct EntryStore {
/// Ciò che il kernel sapeva del vault l'ultima volta.
    /// Dove sta il file. **Non** è opzionale come per la configurazione o
    /// l'organizzazione, che in memoria ci vanno davvero: qui una tabella senza
    /// disco è una tabella che non sa mai niente, cioè il comportamento di
    /// prima del §14.2, e chi lo vuole ottiene lo stesso effetto cancellando il
    path: Utf8PathBuf,
    /// file.
    /// Il supporto del vault (§15.1): la tabella sta sotto `.fub/data/`, cioè
    /// dentro il vault, e ci passa sopra come i documenti
    storage: Arc<dyn VaultStorage>,
    /// ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)).
    /// Ciò che si sa, e che è **anche** ciò che c'è nel file: un [`Durable`]
    /// perché fossero la stessa cosa per costruzione e non per disciplina —
    /// questo campo si assegnava prima della scrittura, e una scrittura fallita
    known: RwLock<Durable<BTreeMap<DocId, StoredEntry>>>,
}

impl EntryStore {
    /// lasciava in memoria una tabella che il disco non aveva.
    /// Apre la tabella di un vault. **Non fallisce mai**: ciò che non si legge
    /// non c'è, e ciò che non c'è si ricostruisce leggendo il vault — che è la
    pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {
        let path = data_root(root).join(FILE);
        EntryStore {
            known: RwLock::new(Durable::new(
                load(&path, storage.as_ref()).unwrap_or_default(),
            )),
            path,
            storage,
        }
    }

    /// definizione di dato derivato.
    pub(crate) fn known(&self, id: &DocId) -> Option<StoredEntry> {
        self.known.read().ok()?.get(id).cloned()
    }

    /// Cosa si sapeva di questo file l'ultima volta.
    /// **Tutto** ciò che si sapeva, per chi ha una domanda sull'insieme e non su
    /// un file.
    ///
    /// Ce n'è uno solo, di cliente, ed è il ricongiungimento delle rinomine
    /// fatte ad app chiusa (§23.1): la sua domanda — *cosa c'era ieri e non c'è
    /// oggi?* — non si può fare un id alla volta, perché l'id di ciò che è
    pub(crate) fn snapshot(&self) -> BTreeMap<DocId, StoredEntry> {
        self.known.read().map(|k| (*k).clone()).unwrap_or_default()
    }

    /// sparito non ce l'ha nessuno da nominare.
    /// Scrive la tabella e la tiene come «ciò che si sa».
    ///
    /// L'errore è una stringa e non risale: chi non riesce a scrivere una cache
    /// ha comunque aperto il vault, e far fallire un'apertura riuscita perché
    /// un file derivato non si è scritto sarebbe il verso sbagliato. Chi chiama
    /// lo annota dove si annotano gli altri esiti che nessuno leggerebbe.
    ///
    /// **La scrittura è incrementale** (difetto 0112): si legge la coda che c'è,
    /// si fonde la propria fotografia sopra la tabella che ne esce
    /// ([`arricchisci`]), e si appende il solo diff — un `upsert` o un
    /// `remove` per voce cambiata, non la tabella intera. L'append non passa
    /// dal lucchetto (0067), e la finestra fra la lettura e l'append è
    /// dichiarata come quella del [`crate::journal`]: un record perso costa
    /// una rilettura, che è il prezzo di un dato derivato.
    ///
    /// La **compattazione** — l'unica riscrittura integrale — scatta quando la
    /// coda supera [`TETTO`] record o quando non c'è una coda da cui partire
    /// (file assente, di una versione che non si conosce, rotto), e passa da
    /// [`update_derived`](crate::storage::VaultStorage::update_derived): la
    /// fusione sotto lucchetto resta — due installazioni che si sovrascrivono
    /// le fotografie si rimettono a rileggere il vault — e a non pagarsi è il
    /// `fsync` finale, che per un file ricostruibile non compra niente. Un
    /// crash può lasciare la coda troncata o assente, e la prossima apertura
    /// la rifà camminando il vault: è il costo che un dato derivato deve
    /// costare, e niente altro.
    ///
    /// **Si scrive prima e si adotta dopo** ([`Durable`]), e non è una
    /// preferenza sull'ordine: al contrario, una scrittura fallita lasciava
    /// `known` a raccontare una tabella che sul disco non c'è: dentro la
    /// sessione «ciò che si sa» e «ciò che si sa*rà* riaprendo» diventavano due
    /// cose diverse, e nessuno le teneva d'occhio perché l'esito non risale.
    /// Con l'ordine giusto un guasto costa ciò che un dato derivato deve
    /// costare — una riapertura lenta — e niente altro.
    ///
    /// **Si adotta ciò che si è composto, non ciò che si portava**
    /// ([`Durable::update`]): la tabella che finisce nel file nasce mettendo
    /// la propria fotografia sopra quella che sul disco c'è adesso — vedi
    /// [`arricchisci`] — e la memoria dev'essere quella, o resterebbe l'unica
    /// copia più povera del file che la porta. Quando a scrivere è la
    /// compattazione, si adotta ciò che **lei** ha scritto: la coda può
    /// essersi allungata di record altrui fra la nostra lettura e il
    pub(crate) fn store(&self, entries: BTreeMap<DocId, StoredEntry>) -> Result<(), String> {
        {
            let known = self.known.read().map_err(|and| and.to_string())?;
            if entries == **known {
                return Ok(());
            }
        }
        let (path, storage) = (&self.path, self.storage.as_ref());
        let mut written = None;
        let mut known = self.known.write().map_err(|and| and.to_string())?;
        known.update(|| {
    // lucchetto, e quelli non si buttano.
            // La coda che c'è adesso, e la tabella che ne esce. `None` per un
            // file che non c'è o che non è una coda nostra (v3, rotto): in
            // quel caso non c'è un diff da fare, c'è una fotografia da
            let raw = storage.read(path).ok();
            let old = raw.as_deref().and_then(decode);
            let mut table = entries.clone();
            if let Some(old) = &old {
                enrich(&mut table, old);
            }
            match &old {
                Some(old) if table == *old => {
            // scrivere.
                    // **Una tabella che il disco ha già non si riscrive.** Da
                    // quando l'anagrafe si scrive anche alla chiusura del
                    // vault, chi apre e chiude senza toccare niente passa di
                    // qui due volte con lo stesso contenuto: senza questa riga
                    // la seconda volta serializzerebbe e riscriverebbe una
                    // riga per file del vault per non dire niente di nuovo. La
                    // domanda si pone **al disco riletto** e non alla memoria,
                    // perché è il disco che decide se c'è qualcosa da cambiare
                    // — e perché la memoria, dopo una fusione, è più ricca
                    // della tabella che il chiamante porta. Resta solo la
                    // compattazione, se la coda è cresciuta sopra il tetto.
                    if raw.as_deref().is_some_and(|r| count_records(r) > CEILING) {
                        compact(path, storage, &table, &mut written)?;
                    }
                }
                Some(old) => {
                    // Un diff, appeso in coda: il costo di un cambiamento è il
                    // record di quel cambiamento, non la tabella intera
                    // (difetto 0112).
                    let mutations = diff(&table, old);
                    let lines = serialize(&mutations);
                    storage
                        .append(path, &lines)
                        .map_err(|and| format!("cannot write {path}: {and}"))?;
                    if raw
                        .as_deref()
                        .is_some_and(|r| count_records(r) + mutations.len() > CEILING)
                    {
                        compact(path, storage, &table, &mut written)?;
                    }
                }
                None => {
                    // Nessuna coda da cui partire: la fotografia intera, che è
                    // anche la compattazione di un file di prima.
                    compact(path, storage, &table, &mut written)?;
                }
            }
            // La fusione compone la tabella anche quando non si scrive niente,
            // perché è comunque ciò che il disco ha. Se un supporto scegliesse
            // di non chiamare la fusione affatto, la memoria resta quella che
            // il chiamante voleva: la stessa tabella, senza l'arricchimento.
            Ok(written.take().unwrap_or(table))
        })
    }
}

/// Ciò che la tabella di chi ha chiuso prima sapeva **in più**, tenuto (difetto
/// 0189).
///
/// Due installazioni sulla stessa cartella scrivono ciascuna la propria
/// fotografia intera del vault, e l'ultima che finisce è quella che resta: fra
/// due fotografie dello stesso disco è la risposta giusta, e non c'è niente da
/// fondere sulla **presenza** — chi scrive ha appena camminato il vault, e un
/// file che la sua fotografia non ha non c'è più. Ma le due non sono ugualmente
/// ricche: l'impronta e i metadati ci sono solo per i file che *quella*
/// installazione ha letto, e chi chiude per secondo senza aver letto niente
/// buttava il lavoro di chi aveva letto tutto — cioè si tornava a rileggere e
/// riparsare il vault alla prima riapertura, che è la cosa che questa tabella
/// esiste per non fare.
///
/// Si arricchisce **solo ciò che c'è già** e solo quando la voce vecchia
/// descrive ancora lo stesso file: `describes` è lo stesso criterio con cui
/// `scan_vault` decide se crederle, quindi qui non entra niente che di là
/// verrebbe rifiutato. Nessuna voce nasce da questa funzione, e nessuna
/// risuscita.
fn enrich(new: &mut BTreeMap<DocId, StoredEntry>, old: &BTreeMap<DocId, StoredEntry>) {
    for (id, entry) in new.iter_mut() {
        let Some(previous) = old.get(id) else {
            continue;
        };
        if !previous.describes(entry.size, entry.mtime) {
            continue;
        }
        if entry.fingerprint.is_none() {
            entry.fingerprint = previous.fingerprint.clone();
        }
        if entry.metadata.is_none() {
            entry.metadata = previous.metadata.clone();
        }
    }
}

/// I byte di una coda, o niente. È la metà di [`load`] che non tocca il
/// supporto, perché la fusione i byte ce li ha già in mano.
///
/// `None` per tutto ciò che non è «una coda nostra, di questa versione»: un
/// file che non comincia con `\n` (v3, o un JSON qualunque), una versione che
/// non si conosce. Un file v4 con una riga rotta in coda o di domani **non** è
/// `None`: quelle righe si scartano e il resto si applica — è la regola del
/// §15.7, la verità non si rifiuta di aprire, si apre dicendo cosa non ha
/// letto.
fn decode(raw: &[u8]) -> Option<BTreeMap<DocId, StoredEntry>> {
    if !raw.starts_with(b"\n") {
        return None;
    }
    let mut table = BTreeMap::new();
    let mut rest = raw;
    while let Some(end) = rest.iter().position(|b| *b == b'\n') {
        let line = &rest[..end];
        rest = &rest[end + 1..];
        if line.is_empty() {
            // Il delimitatore in testa di chi ha appeso dopo un'interruzione:
            // non è un record, e non si conta.
            continue;
        }
        let Ok(record) = serde_json::from_slice::<Record>(line) else {
            // Una riga rotta — la coda troncata da un crash — o di una forma
            // che non si conosce: si scarta, e ciò che viene prima si è letto
            // tutto.
            continue;
        };
        if record.v != SCHEMA_VERSION {
            // Un record di domani: si salta come si salta una riga rotta.
            continue;
        }
        match record.mutation {
            Mutation::Upsert { id, entry } => {
                table.insert(id, *entry);
            }
            Mutation::Remove { id } => {
                table.remove(&id);
            }
            Mutation::Snapshot { entries } => {
                table = entries;
            }
        }
    }
    Some(table)
}

/// Le righe non vuote di una coda: quante mutazioni ci stanno, per decidere se
/// compattare. Una riga vuota è il delimitatore in testa di chi ha appeso dopo
/// un'interruzione, e contarla farebbe tagliare al tetto sbagliato — la stessa
/// ragione per cui il [`crate::journal`] non la conta.
/// Le mutazioni che portano `old` a `new`, in ordine di id: un `upsert`
fn count_records(raw: &[u8]) -> usize {
    raw.split(|b| *b == b'\n')
        .filter(|line| !line.is_empty())
        .count()
}

/// per ogni voce che cambia o nasce, un `remove` per ogni voce che sparisce.
/// È ciò che si appende, e la sua lunghezza è il costo di un salvataggio —
/// non la dimensione della tabella (difetto 0112).
/// Le righe dei record, ognuna auto-delimitante (`\n{…}\n`): chi appende dopo
fn diff(
    new: &BTreeMap<DocId, StoredEntry>,
    old: &BTreeMap<DocId, StoredEntry>,
) -> Vec<Mutation> {
    let mut mutations = Vec::new();
    for (id, entry) in new {
        match old.get(id) {
            Some(previous) if previous == entry => {}
            _ => mutations.push(Mutation::Upsert {
                id: id.clone(),
                entry: Box::new(entry.clone()),
            }),
        }
    }
    for id in old.keys() {
        if !new.contains_key(id) {
            mutations.push(Mutation::Remove { id: id.clone() });
        }
    }
    mutations
}

/// un'interruzione non si attacca in fondo a ciò che il crash ha lasciato, e
/// l'ultima riga di un file scritto per intero è finita come le altre. È il
/// formato del [`crate::journal`], e per la stessa ragione.
/// La compattazione: riscrive il file con la sola fotografia, sotto lucchetto
fn serialize(mutations: &[Mutation]) -> Vec<u8> {
    let mut lines = Vec::new();
    for mutation in mutations {
        let record = Record {
            v: SCHEMA_VERSION,
            mutation: mutation.clone(),
        };
        let json = serde_json::to_vec(&record).expect("an entry-store record serializes");
        lines.push(b'\n');
        lines.extend_from_slice(&json);
        lines.push(b'\n');
    }
    lines
}

/// ([`VaultStorage::update_derived`]).
///
/// La tabella scritta è quella del disco se la coda si legge ancora, altrimenti
/// quella fusa: la coda può essersi allungata di record altrui fra la nostra
/// lettura e il lucchetto, e quelli non si buttano — e una coda illeggibile non
/// deve diventare uno snapshot vuoto. `scritta` riceve ciò che la fusione ha
/// prodotto, perché la memoria adotti la tabella che il disco ha accettato.
            // Il record si delimita da sé, come ogni riga del file: il `\n` in
            // testa è ciò che [`decodifica`] usa per riconoscere una coda
fn compact(
    path: &Utf8Path,
    storage: &dyn VaultStorage,
    merged: &BTreeMap<DocId, StoredEntry>,
    written: &mut Option<BTreeMap<DocId, StoredEntry>>,
) -> Result<(), String> {
    storage
        .update_derived(path, &mut |old: Option<&[u8]>| {
            let table = old.and_then(decode).unwrap_or_else(|| merged.clone());
            let record = Record {
                v: SCHEMA_VERSION,
                mutation: Mutation::Snapshot { entries: &table },
            };
            let mut json = serde_json::to_vec(&record).map_err(std::io::Error::other)?;
            // nostra, e chi appenderà dopo di noi non deve sapere come siamo
            // finiti.
        // Le cartelle mancanti le crea il supporto, che è dove quella riga sta
        // scritta una volta sola (§15.1).
            json.insert(0, b'\n');
            json.push(b'\n');
            written.replace(table);
            Ok(Some(json))
        })
// Legge la tabella.
//
        .map_err(|and| format!("cannot write {path}: {and}"))
}

/// `None` per tutto ciò che non è «un file nostro, di questa versione, leggibile
/// per intero»: un errore di I/O, un file che non è una coda, una versione che
/// non si conosce. Nessuno dei tre è un avviso — sono tutti «ricomincia dal
/// vault». Una coda v4 con righe rotte in coda **non** è `None`: si legge ciò
/// che si capisce, e ciò che non si capisce si scarta (§15.7).
///
/// Qui non c'è più nessun vaglio *racily clean*, e non perché la regola sia
/// caduta: è stata spostata dove si osserva, cioè al momento in cui una voce
/// entra in anagrafe (difetto 0187). Ciò che è scritto qui è già passato di lì.
    /// Un supporto che **conta come l'anagrafe passa dal disco**: le `append`
    /// (le mutazioni incrementali) da una parte, le riscritture integrali —
fn load(path: &Utf8Path, storage: &dyn VaultStorage) -> Option<BTreeMap<DocId, StoredEntry>> {
    decode(&storage.read(path).ok()?)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
        (dir, path)
    }

    fn entry(size: u64, mtime: u64) -> StoredEntry {
        StoredEntry {
            size,
            mtime,
            fingerprint: None,
            metadata: None,
        }
    }

    /// un `update` che risponde con dei byte, o una `write` — dall'altra. È
    /// la stessa cucitura di `SupportoCheConta`
    /// (`l_anagrafe_si_chiude_con_il_vault.rs`) stretta sulla domanda del
    /// difetto 0112.
        /// La compattazione passa di qui e non dalla `write`, perché si fonde
        /// con ciò che sul disco c'è adesso: a contare è la fusione che
    struct CountingBackingStore {
        inner: crate::storage::MemStorage,
        entry_store_appends: Arc<AtomicUsize>,
        entry_store_rewrites: Arc<AtomicUsize>,
    }

    impl CountingBackingStore {
        fn new() -> Self {
            CountingBackingStore {
                inner: crate::storage::MemStorage::new(),
                entry_store_appends: Arc::new(AtomicUsize::new(0)),
                entry_store_rewrites: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    impl VaultStorage for CountingBackingStore {
        fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
            self.inner.read(path)
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<crate::storage::Stat> {
            if path.as_str().ends_with("entries.json") {
                self.entry_store_rewrites
                    .fetch_add(1, Ordering::Relaxed);
            }
            self.inner.write(path, bytes)
        }
        /// risponde con dei byte, cioè il file che cambia davvero — un
        /// aggiornamento che risponde «non scrivo» non è una scrittura.
    /// **Chi chiude per secondo non butta ciò che chi ha chiuso per primo aveva
    /// letto** (difetto 0189).
        fn update(
            &self,
            path: &Utf8Path,
            merge_entries: crate::storage::Merge<'_>,
        ) -> std::io::Result<()> {
            let is_entry_store = path.as_str().ends_with("entries.json");
            let rewrites = Arc::clone(&self.entry_store_rewrites);
            let mut counting = move |old: Option<&[u8]>| {
                let result = merge_entries(old);
                if is_entry_store && matches!(result, Ok(Some(_))) {
                    rewrites.fetch_add(1, Ordering::Relaxed);
                }
                result
            };
            self.inner.update(path, &mut counting)
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
            if path.as_str().ends_with("entries.json") {
                self.entry_store_appends.fetch_add(1, Ordering::Relaxed);
            }
            self.inner.append(path, bytes)
        }
        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
            self.inner.rename(from, to)
        }
        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
            self.inner.rename_no_replace(from, to)
        }
        fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
            self.inner.remove(path)
        }
        fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<crate::storage::DirEntry>> {
            self.inner.list(dir)
        }
        fn stat(&self, path: &Utf8Path) -> std::io::Result<crate::storage::Stat> {
            self.inner.stat(path)
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
            self.inner.remove_empty_dir(dir)
        }
    }

    #[test]
    fn survives_a_round_trip_on_disk() {
        let (_tmp, root) = tempdir();
        let store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(store.known(&DocId::new("a.md")).is_none());
        store
            .store(BTreeMap::from([(DocId::new("a.md"), entry(3, 1_000))]))
            .expect("writes");

        let reread = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        let entry = reread.known(&DocId::new("a.md")).expect("finds it again");
        assert!(entry.describes(3, 1_000));
        assert!(!entry.describes(3, 1_001), "mtime is part of the criterion");
        assert!(!entry.describes(4, 1_000), "and so is size");
    }

    ///
    /// La riga chiedeva per `store` «il lock che le altre riscritture integrali
    /// prendono», e quel lock non esisteva da nessuna parte: in questo kernel il
    /// lucchetto accompagna sempre una **rilettura** — `update_atomic` e
    /// `VaultStorage::update`, gli unici due che lo prendono — e il perché sta
    /// scritto lì accanto, «chi prende il lock e poi ricompone dalla copia
    /// vecchia non ha risolto niente». Preso da solo non avrebbe curato niente
    /// nemmeno qui: due fotografie intere dello stesso disco restano due, e
    /// serializzarle lascia comunque vincere l'ultima.
    ///
    /// A vincere l'ultima va bene per la **presenza** — chi scrive ha appena
    /// camminato il vault — e non per la ricchezza: l'impronta e i metadati ce
    /// li ha solo chi ha letto i file. Qui la prima installazione ha letto, la
    /// seconda no, e la seconda chiude dopo; senza la fusione la sua fotografia
    /// povera copre quella ricca e la riapertura successiva rilegge e riparsa
    /// l'intero vault — cioè la cosa che questa tabella esiste per non fare.
        // La seconda installazione apre **prima** che la prima abbia scritto:
        // ciò che scriverà alla chiusura è tutto ciò che sa, e non sa niente.
    #[test]
    fn second_closer_does_not_discard_footprints_of_the_first_reader() {
        let (_tmp, root) = tempdir();
        let fs = || Arc::new(crate::storage::FsStorage);
        let fingerprint = Revision::new("0123456789abcdef");

                // Stesso file, stessa dimensione, stessa data: l'impronta che
                // non ha è ancora buona.
                // Lo stesso nome, ma il disco l'ha smentita: qui l'impronta
        let second = EntryStore::open(&root, fs());

        let first = EntryStore::open(&root, fs());
        first
            .store(BTreeMap::from([
                (
                    DocId::new("read.md"),
                    StoredEntry {
                        fingerprint: Some(fingerprint.clone()),
                        ..entry(3, 1_000)
                    },
                ),
                (
                    DocId::new("changed.md"),
                    StoredEntry {
                        fingerprint: Some(fingerprint.clone()),
                        ..entry(3, 1_000)
                    },
                ),
                (DocId::new("vanished.md"), entry(9, 1_000)),
            ]))
            .expect("the first closes, and it read");

        second
            .store(BTreeMap::from([
                // vecchia sarebbe una bugia scritta su disco.
        // È la differenza con l'organizzazione (§11.3), che un file rotto lo
                (DocId::new("read.md"), entry(3, 1_000)),
        // protegge: quello è autorevole, questo si rifà camminando il vault.
    // **Una scrittura che non è avvenuta non si ricorda.**
                (DocId::new("changed.md"), entry(4, 1_100)),
            ]))
            .expect("the second closes second, and it read nothing");

        let reread = EntryStore::open(&root, fs());
        assert_eq!(
            reread
                .known(&DocId::new("read.md"))
                .and_then(|v| v.fingerprint.clone()),
            Some(fingerprint),
            "the fingerprint of whoever had read was overwritten by whoever \
             had not: at the next open a file that nobody touched is reread \
             and reparsed"
        );
        assert_eq!(
            reread
                .known(&DocId::new("changed.md"))
                .and_then(|v| v.fingerprint.clone()),
            None,
            "a fingerprint that the disk has contradicted is not kept: it \
             would leave an index stuck on content that no longer exists"
        );
        assert!(
            reread.known(&DocId::new("vanished.md")).is_none(),
            "the merge resurrected a file that the latest snapshot does not \
             have: the writer just walked the vault, and on presence it is \
             the authority"
        );
        assert_eq!(
            second
                .known(&DocId::new("read.md"))
                .and_then(|v| v.fingerprint.clone()),
            reread
                .known(&DocId::new("read.md"))
                .and_then(|v| v.fingerprint.clone()),
            "whoever stayed open and whoever reopens do not see the same \
             table: memory must be what the disk accepted"
        );
    }

    #[test]
    fn an_unreadable_table_is_not_a_warning_and_does_not_block_anything() {
    //
    // Il guasto non si aspetta, si inietta, e qui non serve nemmeno un
    // supporto finto: `.fub/data` è un **file** invece che una cartella, cioè
        let (_tmp, root) = tempdir();
        let path = data_root(&root).join(FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ non json").unwrap();

        let store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(store.known(&DocId::new("a.md")).is_none());
        store
            .store(BTreeMap::from([(DocId::new("a.md"), entry(1, 10))]))
            .expect("and the first write replaces it without asking");
        assert!(EntryStore::open(&root, Arc::new(crate::storage::FsStorage))
            .known(&DocId::new("a.md"))
            .is_some());
    }

    /// la stessa `ENOTDIR` che un disco pieno o un permesso tolto darebbero a
    /// chi prova a scrivere là sotto. È la forma di `SupportoCheRifiuta`
    /// (`tests/trash.rs`) senza il supporto, perché questo modulo si guarda da
    /// dentro e là il tipo è locale a un banco di integrazione.
    ///
    /// Con l'ordine di prima — `self.known = entries` e *poi* la scrittura — il
    /// banco è rosso: la tabella resta in memoria, `known` risponde di sì, e
    /// «ciò che si sa» e «ciò che si saprà riaprendo» diventavano due cose
    /// diverse per tutta la sessione. L'esito di `store` non risale a nessuno
    /// (è un derivato, apposta), quindi non c'era nemmeno chi potesse
    /// accorgersene.
    /// L'anagrafe passa dal supporto, e ci passa **davvero**: su un supporto in
    /// memoria non deve restare niente sul disco. È la casella residua della
    /// 0064 vista da qui — un `std::fs` rimasto dentro questo modulo non fa
    /// fallire nessun test di conformità del trait, fa fallire questo.
    #[test]
    fn what_the_disk_rejected_does_not_remain_in_memory() {
        let (_tmp, root) = tempdir();
        std::fs::create_dir_all(root.join(crate::vault::FUB_DIR)).unwrap();
        std::fs::write(data_root(&root), "I am not a directory").unwrap();

        let store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        let and = store
            .store(BTreeMap::from([(DocId::new("a.md"), entry(3, 1_000))]))
            .expect_err("the directory cannot be created");

        assert!(
            store.known(&DocId::new("a.md")).is_none(),
            "\"{and}\": memory must not report a table the disk does not have"
        );
        assert!(
            EntryStore::open(&root, Arc::new(crate::storage::FsStorage))
                .known(&DocId::new("a.md"))
                .is_none(),
            "and whoever reopens sees the same as whoever stayed open"
        );
    }

    /// **Cambiare una voce su N appende il solo record, e non riscrive la
    /// tabella intera** (difetto 0112).
    ///
    /// Il difetto: `EntryStore::store` riserializzava e riscriveva l'intera
    #[test]
    fn goes_through_the_backing_store_not_through_the_disk() {
        let storage = Arc::new(crate::storage::MemStorage::new());
        let root = Utf8Path::new("/vault-entry-store");
        let store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        store
            .store(BTreeMap::from([(DocId::new("a.md"), entry(3, 1_000))]))
            .expect("writes");

        assert!(
            storage.exists(&data_root(root).join(FILE)),
            "the table ended up on the backing store"
        );
        assert!(
            !std::path::Path::new("/vault-entry-store").exists(),
            "and not on the real filesystem"
        );
        assert!(
            EntryStore::open(root, storage as Arc<dyn VaultStorage>)
                .known(&DocId::new("a.md"))
                .is_some(),
            "and is reread from there"
        );
    }

    #[test]
    fn an_unknown_version_is_discarded() {
        let (_tmp, root) = tempdir();
        let path = data_root(&root).join(FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"version":99,"written_at":9,"entries":{"a.md":{"size":1,"mtime":1}}}"#,
        )
        .unwrap();
        assert!(
            EntryStore::open(&root, Arc::new(crate::storage::FsStorage))
                .known(&DocId::new("a.md"))
                .is_none(),
            "a derived thing of an unknown version is not guessed at: it is rebuilt"
        );
    }

    /// `BTreeMap` a ogni voce cambiata, e su un vault grande il prezzo si
    /// pagava a ogni salvataggio. Il banco conta come l'anagrafe passa dal
    /// supporto: la prima scrittura è una fotografia (una riscrittura
    /// integrale, ed è giusto — il file non c'era), la seconda — una voce
    /// cambiata su mille — dev'essere **un'append sola e zero riscritture**.
    /// Con il formato di prima il banco è rosso: la seconda scrittura è una
    /// riscrittura integrale, e il conto delle append resta a zero.
        // E la coda si rilegge: chi riapre vede la voce cambiata e le altre
        // novecentonovantanove ferme.
    /// **Una coda troncata non fa rifiutare il resto** (§15.7): la riga rotta
    /// in coda si scarta, e ciò che viene prima si legge tutto. È la promessa
    #[test]
    fn one_changed_entry_out_of_a_thousand_appends_and_does_not_rewrite() {
        let storage = Arc::new(CountingBackingStore::new());
        let root = Utf8Path::new("/vault-entry-store");
        let store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);

        let thousand: BTreeMap<_, _> = (0..1_000)
            .map(|the| (DocId::new(format!("note{the:04}.md")), entry(the as u64, 1_000)))
            .collect();
        store
            .store(thousand.clone())
            .expect("the first write: the snapshot, because the file did not exist");

        let mut changed = thousand.clone();
        changed.insert(DocId::new("note0000.md"), entry(0, 1_001));
        store
            .store(changed)
            .expect("the second write: one changed entry out of a thousand");

        assert_eq!(
            storage.entry_store_appends.load(Ordering::Relaxed),
            1,
            "the change passed through the disk as a single append: the cost \
             of a save is the record for what changed, not the entire table"
        );
        assert_eq!(
            storage.entry_store_rewrites.load(Ordering::Relaxed),
            1,
            "and the full rewrite remained the initial snapshot: the second \
             write did not rewrite the table"
        );

    // che rende sicuro l'append senza atomicità — un crash a metà aggiunta
    // lascia una riga rotta, non una tabella persa.
        let reread = EntryStore::open(root, storage as Arc<dyn VaultStorage>);
        assert!(
            reread
                .known(&DocId::new("note0000.md"))
                .expect("the entry is there")
                .describes(0, 1_001),
            "the changed entry is the new one"
        );
        assert!(
            reread
                .known(&DocId::new("note0001.md"))
                .expect("the entry is there")
                .describes(1, 1_000),
            "and the others remain as before"
        );
    }

    // La regola *racily clean* aveva qui il suo banco, e presidiava la soglia
    // sbagliata: «non anteriore alla **scrittura della tabella**». La soglia è
    // il momento dell'osservazione (difetto 0187), che questo modulo non vede —
    // fra l'una e l'altra ci sta una sessione intera —, e il banco è andato
    #[test]
    fn a_truncated_queue_is_read_up_to_the_broken_line() {
        let storage = Arc::new(CountingBackingStore::new());
        let root = Utf8Path::new("/vault-entry-store");
        let store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        store
            .store(BTreeMap::from([(DocId::new("a.md"), entry(1, 10))]))
            .expect("the snapshot");

        let path = data_root(root).join(FILE);
        let mut raw = storage.inner.read(&path).expect("the queue");
        raw.extend_from_slice(
            b"\n{\"v\":4,\"op\":\"upsert\",\"id\":\"b.md\",\"entry\":{\"size\":2,\"mtime\":20}",
        );
        storage.inner.write(&path, &raw).expect("the mid-crash state");

        let reread = EntryStore::open(root, storage as Arc<dyn VaultStorage>);
        assert!(
            reread
                .known(&DocId::new("a.md"))
                .expect("the entry is there")
                .describes(1, 10),
            "everything before the broken line has been read"
        );
        assert!(
            reread.known(&DocId::new("b.md")).is_none(),
            "and the broken line was discarded, not guessed"
        );
    }

    // dove la regola sta adesso: `anagrafe.rs`,
    // `una_data_che_puo_ancora_cambiare_non_finisce_in_anagrafe`.
    // il momento dell'osservazione (difetto 0187), che questo modulo non vede —
    // fra l'una e l'altra ci sta una sessione intera —, e il banco è andato
    // dove la regola sta adesso: `anagrafe.rs`,
    // `una_data_che_puo_ancora_cambiare_non_finisce_in_anagrafe`.
}
