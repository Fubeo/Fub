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

use crate::storage::{Durevole, VaultStorage};
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
/// salvataggio.
const TETTO: usize = 10_000;

/// Una mutazione della tabella, come sta su una riga del file.
///
/// Internally-tagged su `op` perché la riga si legga a colpo d'occhio:
/// `{"v":4,"op":"upsert","id":"a.md","entry":{…}}`. Generica sul solo campo
/// che pesa, come lo era [`EntriesFile`]: la compattazione scrive
/// `Snapshot { entries: &tabella }` senza copiare la tabella intera.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Mutazione<E = BTreeMap<DocId, StoredEntry>> {
    /// Una voce nuova o cambiata: si mette al suo posto, coprendo ciò che c'era.
    /// Il payload sta in un `Box` perché chi porta solo un `Remove` non deve
    /// pagare il posto di [`StoredEntry`] — e serde lo attraversa, quindi
    /// la riga su disco non cambia di un byte.
    Upsert { id: DocId, entry: Box<StoredEntry> },
    /// Una voce sparita: si toglie, se c'è.
    Remove { id: DocId },
    /// La fotografia intera: azzera la tabella e la sostituisce. È il record
    /// della compattazione, e il primo record di un file che nasce.
    Snapshot { entries: E },
}

/// Un record del file: la versione di schema e la mutazione.
///
/// Generico come [`Mutazione`], per la stessa ragione: la compattazione
/// serializza `Snapshot { entries: &tabella }` senza copiare la tabella.
#[derive(Serialize, Deserialize)]
struct Record<E = BTreeMap<DocId, StoredEntry>> {
    v: SchemaVersion,
    #[serde(flatten)]
    mutazione: Mutazione<E>,
}

/// I metadati di un documento che l'anagrafe si ricorda: ciò che il kernel
/// avrebbe dovuto **rileggere e riparsare** il file per riavere.
///
/// Il **corpo** non c'è, come non c'è nella cache in memoria (`DocMeta`) e per
/// la stessa ragione: il render lo riparsa dal disco su richiesta, e tenerlo qui
/// vorrebbe dire scrivere l'intero vault una seconda volta accanto a sé stesso.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct StoredMeta {
    #[serde(default)]
    pub(crate) frontmatter: Frontmatter,
    #[serde(default)]
    pub(crate) outline: Vec<Heading>,
    #[serde(default)]
    pub(crate) links: Vec<Link>,
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
    /// cioè il buco della §21.10 riaperto dalla cache invece che dalla firma.
    #[serde(default)]
    pub(crate) anchors: Vec<Anchor>,
    /// I tag **come la nota li scrive** (`#Rust`, non `rust`): è ciò che
    /// [`TagCounts`](crate::tag_counts::TagCounts) prende in ingresso, e
    /// riscriverli in forma canonica farebbe sparire la grafia dal pannello dei
    /// tag alla prima riapertura.
    ///
    /// I nomi e non i [`Tag`](fub_abi::model::Tag) interi: un `Tag` porta lo
    /// **span**, che è una posizione dentro un sorgente che qui non c'è. Uno
    /// span inventato sarebbe un dato falso scritto su disco.
    #[serde(default)]
    pub(crate) tags: Vec<String>,
}

/// Una voce come sta sul file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct StoredEntry {
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fingerprint: Option<Revision>,
    /// Assente per ciò che non è un documento: un PNG non ha un modello, e
    /// nessuno lo riparsa.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) meta: Option<StoredMeta>,
}

impl StoredEntry {
    /// Questa voce descrive ancora il file che la scansione ha trovato?
    ///
    /// Dimensione **e** data: la dimensione da sola cambia raramente per una
    /// modifica vera (una parola sostituita con un'altra della stessa
    /// lunghezza), la data da sola cambia anche quando il contenuto non cambia.
    pub(crate) fn describes(&self, size: u64, mtime: u64) -> bool {
        self.size == size && self.mtime == mtime
    }
}

/// Ciò che il kernel sapeva del vault l'ultima volta.
pub(crate) struct EntryStore {
    /// Dove sta il file. **Non** è opzionale come per la configurazione o
    /// l'organizzazione, che in memoria ci vanno davvero: qui una tabella senza
    /// disco è una tabella che non sa mai niente, cioè il comportamento di
    /// prima del §14.2, e chi lo vuole ottiene lo stesso effetto cancellando il
    /// file.
    path: Utf8PathBuf,
    /// Il supporto del vault (§15.1): la tabella sta sotto `.fub/data/`, cioè
    /// dentro il vault, e ci passa sopra come i documenti
    /// ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)).
    storage: Arc<dyn VaultStorage>,
    /// Ciò che si sa, e che è **anche** ciò che c'è nel file: un [`Durevole`]
    /// perché fossero la stessa cosa per costruzione e non per disciplina —
    /// questo campo si assegnava prima della scrittura, e una scrittura fallita
    /// lasciava in memoria una tabella che il disco non aveva.
    known: RwLock<Durevole<BTreeMap<DocId, StoredEntry>>>,
}

impl EntryStore {
    /// Apre la tabella di un vault. **Non fallisce mai**: ciò che non si legge
    /// non c'è, e ciò che non c'è si ricostruisce leggendo il vault — che è la
    /// definizione di dato derivato.
    pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {
        let path = data_root(root).join(FILE);
        EntryStore {
            known: RwLock::new(Durevole::letto(
                load(&path, storage.as_ref()).unwrap_or_default(),
            )),
            path,
            storage,
        }
    }

    /// Cosa si sapeva di questo file l'ultima volta.
    pub(crate) fn known(&self, id: &DocId) -> Option<StoredEntry> {
        self.known.read().ok()?.get(id).cloned()
    }

    /// **Tutto** ciò che si sapeva, per chi ha una domanda sull'insieme e non su
    /// un file.
    ///
    /// Ce n'è uno solo, di cliente, ed è il ricongiungimento delle rinomine
    /// fatte ad app chiusa (§23.1): la sua domanda — *cosa c'era ieri e non c'è
    /// oggi?* — non si può fare un id alla volta, perché l'id di ciò che è
    /// sparito non ce l'ha nessuno da nominare.
    pub(crate) fn snapshot(&self) -> BTreeMap<DocId, StoredEntry> {
        self.known.read().map(|k| (*k).clone()).unwrap_or_default()
    }

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
    /// **Si scrive prima e si adotta dopo** ([`Durevole`]), e non è una
    /// preferenza sull'ordine: al contrario, una scrittura fallita lasciava
    /// `known` a raccontare una tabella che sul disco non c'è: dentro la
    /// sessione «ciò che si sa» e «ciò che si sa*rà* riaprendo» diventavano due
    /// cose diverse, e nessuno le teneva d'occhio perché l'esito non risale.
    /// Con l'ordine giusto un guasto costa ciò che un dato derivato deve
    /// costare — una riapertura lenta — e niente altro.
    ///
    /// **Si adotta ciò che si è composto, non ciò che si portava**
    /// ([`Durevole::aggiorna`]): la tabella che finisce nel file nasce mettendo
    /// la propria fotografia sopra quella che sul disco c'è adesso — vedi
    /// [`arricchisci`] — e la memoria dev'essere quella, o resterebbe l'unica
    /// copia più povera del file che la porta. Quando a scrivere è la
    /// compattazione, si adotta ciò che **lei** ha scritto: la coda può
    /// essersi allungata di record altrui fra la nostra lettura e il
    /// lucchetto, e quelli non si buttano.
    pub(crate) fn store(&self, entries: BTreeMap<DocId, StoredEntry>) -> Result<(), String> {
        {
            let known = self.known.read().map_err(|e| e.to_string())?;
            if entries == **known {
                return Ok(());
            }
        }
        let (path, storage) = (&self.path, self.storage.as_ref());
        let mut scritta = None;
        let mut known = self.known.write().map_err(|e| e.to_string())?;
        known.aggiorna(|| {
            // La coda che c'è adesso, e la tabella che ne esce. `None` per un
            // file che non c'è o che non è una coda nostra (v3, rotto): in
            // quel caso non c'è un diff da fare, c'è una fotografia da
            // scrivere.
            let raw = storage.read(path).ok();
            let vecchia = raw.as_deref().and_then(decodifica);
            let mut tabella = entries.clone();
            if let Some(vecchia) = &vecchia {
                arricchisci(&mut tabella, vecchia);
            }
            match &vecchia {
                Some(vecchia) if tabella == *vecchia => {
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
                    if raw.as_deref().is_some_and(|r| conta_record(r) > TETTO) {
                        compatta(path, storage, &tabella, &mut scritta)?;
                    }
                }
                Some(vecchia) => {
                    // Un diff, appeso in coda: il costo di un cambiamento è il
                    // record di quel cambiamento, non la tabella intera
                    // (difetto 0112).
                    let mutazioni = diff(&tabella, vecchia);
                    let righe = serializza(&mutazioni);
                    storage
                        .append(path, &righe)
                        .map_err(|e| format!("non riesco a scrivere {path}: {e}"))?;
                    if raw
                        .as_deref()
                        .is_some_and(|r| conta_record(r) + mutazioni.len() > TETTO)
                    {
                        compatta(path, storage, &tabella, &mut scritta)?;
                    }
                }
                None => {
                    // Nessuna coda da cui partire: la fotografia intera, che è
                    // anche la compattazione di un file di prima.
                    compatta(path, storage, &tabella, &mut scritta)?;
                }
            }
            // La fusione compone la tabella anche quando non si scrive niente,
            // perché è comunque ciò che il disco ha. Se un supporto scegliesse
            // di non chiamare la fusione affatto, la memoria resta quella che
            // il chiamante voleva: la stessa tabella, senza l'arricchimento.
            Ok(scritta.take().unwrap_or(tabella))
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
fn arricchisci(nuova: &mut BTreeMap<DocId, StoredEntry>, vecchia: &BTreeMap<DocId, StoredEntry>) {
    for (id, voce) in nuova.iter_mut() {
        let Some(prima) = vecchia.get(id) else {
            continue;
        };
        if !prima.describes(voce.size, voce.mtime) {
            continue;
        }
        if voce.fingerprint.is_none() {
            voce.fingerprint = prima.fingerprint.clone();
        }
        if voce.meta.is_none() {
            voce.meta = prima.meta.clone();
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
fn decodifica(raw: &[u8]) -> Option<BTreeMap<DocId, StoredEntry>> {
    if !raw.starts_with(b"\n") {
        return None;
    }
    let mut tabella = BTreeMap::new();
    let mut resto = raw;
    while let Some(fine) = resto.iter().position(|b| *b == b'\n') {
        let riga = &resto[..fine];
        resto = &resto[fine + 1..];
        if riga.is_empty() {
            // Il delimitatore in testa di chi ha appeso dopo un'interruzione:
            // non è un record, e non si conta.
            continue;
        }
        let Ok(record) = serde_json::from_slice::<Record>(riga) else {
            // Una riga rotta — la coda troncata da un crash — o di una forma
            // che non si conosce: si scarta, e ciò che viene prima si è letto
            // tutto.
            continue;
        };
        if record.v != SCHEMA_VERSION {
            // Un record di domani: si salta come si salta una riga rotta.
            continue;
        }
        match record.mutazione {
            Mutazione::Upsert { id, entry } => {
                tabella.insert(id, *entry);
            }
            Mutazione::Remove { id } => {
                tabella.remove(&id);
            }
            Mutazione::Snapshot { entries } => {
                tabella = entries;
            }
        }
    }
    Some(tabella)
}

/// Le righe non vuote di una coda: quante mutazioni ci stanno, per decidere se
/// compattare. Una riga vuota è il delimitatore in testa di chi ha appeso dopo
/// un'interruzione, e contarla farebbe tagliare al tetto sbagliato — la stessa
/// ragione per cui il [`crate::journal`] non la conta.
fn conta_record(raw: &[u8]) -> usize {
    raw.split(|b| *b == b'\n')
        .filter(|riga| !riga.is_empty())
        .count()
}

/// Le mutazioni che portano `vecchia` a `nuova`, in ordine di id: un `upsert`
/// per ogni voce che cambia o nasce, un `remove` per ogni voce che sparisce.
/// È ciò che si appende, e la sua lunghezza è il costo di un salvataggio —
/// non la dimensione della tabella (difetto 0112).
fn diff(
    nuova: &BTreeMap<DocId, StoredEntry>,
    vecchia: &BTreeMap<DocId, StoredEntry>,
) -> Vec<Mutazione> {
    let mut mutazioni = Vec::new();
    for (id, voce) in nuova {
        match vecchia.get(id) {
            Some(prima) if prima == voce => {}
            _ => mutazioni.push(Mutazione::Upsert {
                id: id.clone(),
                entry: Box::new(voce.clone()),
            }),
        }
    }
    for id in vecchia.keys() {
        if !nuova.contains_key(id) {
            mutazioni.push(Mutazione::Remove { id: id.clone() });
        }
    }
    mutazioni
}

/// Le righe dei record, ognuna auto-delimitante (`\n{…}\n`): chi appende dopo
/// un'interruzione non si attacca in fondo a ciò che il crash ha lasciato, e
/// l'ultima riga di un file scritto per intero è finita come le altre. È il
/// formato del [`crate::journal`], e per la stessa ragione.
fn serializza(mutazioni: &[Mutazione]) -> Vec<u8> {
    let mut righe = Vec::new();
    for mutazione in mutazioni {
        let record = Record {
            v: SCHEMA_VERSION,
            mutazione: mutazione.clone(),
        };
        let json = serde_json::to_vec(&record).expect("un record dell'anagrafe si serializza");
        righe.push(b'\n');
        righe.extend_from_slice(&json);
        righe.push(b'\n');
    }
    righe
}

/// La compattazione: riscrive il file con la sola fotografia, sotto lucchetto
/// ([`VaultStorage::update_derived`]).
///
/// La tabella scritta è quella del disco se la coda si legge ancora, altrimenti
/// quella fusa: la coda può essersi allungata di record altrui fra la nostra
/// lettura e il lucchetto, e quelli non si buttano — e una coda illeggibile non
/// deve diventare uno snapshot vuoto. `scritta` riceve ciò che la fusione ha
/// prodotto, perché la memoria adotti la tabella che il disco ha accettato.
fn compatta(
    path: &Utf8Path,
    storage: &dyn VaultStorage,
    fusa: &BTreeMap<DocId, StoredEntry>,
    scritta: &mut Option<BTreeMap<DocId, StoredEntry>>,
) -> Result<(), String> {
    storage
        .update_derived(path, &mut |vecchia: Option<&[u8]>| {
            let tabella = vecchia.and_then(decodifica).unwrap_or_else(|| fusa.clone());
            let record = Record {
                v: SCHEMA_VERSION,
                mutazione: Mutazione::Snapshot { entries: &tabella },
            };
            let mut json = serde_json::to_vec(&record).map_err(std::io::Error::other)?;
            // Il record si delimita da sé, come ogni riga del file: il `\n` in
            // testa è ciò che [`decodifica`] usa per riconoscere una coda
            // nostra, e chi appenderà dopo di noi non deve sapere come siamo
            // finiti.
            json.insert(0, b'\n');
            json.push(b'\n');
            scritta.replace(tabella);
            Ok(Some(json))
        })
        // Le cartelle mancanti le crea il supporto, che è dove quella riga sta
        // scritta una volta sola (§15.1).
        .map_err(|e| format!("non riesco a scrivere {path}: {e}"))
}

/// Legge la tabella.
///
/// `None` per tutto ciò che non è «un file nostro, di questa versione, leggibile
/// per intero»: un errore di I/O, un file che non è una coda, una versione che
/// non si conosce. Nessuno dei tre è un avviso — sono tutti «ricomincia dal
/// vault». Una coda v4 con righe rotte in coda **non** è `None`: si legge ciò
/// che si capisce, e ciò che non si capisce si scarta (§15.7).
///
/// Qui non c'è più nessun vaglio *racily clean*, e non perché la regola sia
/// caduta: è stata spostata dove si osserva, cioè al momento in cui una voce
/// entra in anagrafe (difetto 0187). Ciò che è scritto qui è già passato di lì.
fn load(path: &Utf8Path, storage: &dyn VaultStorage) -> Option<BTreeMap<DocId, StoredEntry>> {
    decodifica(&storage.read(path).ok()?)
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

    fn voce(size: u64, mtime: u64) -> StoredEntry {
        StoredEntry {
            size,
            mtime,
            fingerprint: None,
            meta: None,
        }
    }

    /// Un supporto che **conta come l'anagrafe passa dal disco**: le `append`
    /// (le mutazioni incrementali) da una parte, le riscritture integrali —
    /// un `update` che risponde con dei byte, o una `write` — dall'altra. È
    /// la stessa cucitura di `SupportoCheConta`
    /// (`l_anagrafe_si_chiude_con_il_vault.rs`) stretta sulla domanda del
    /// difetto 0112.
    struct SupportoCheConta {
        inner: crate::storage::MemStorage,
        append_dell_anagrafe: Arc<AtomicUsize>,
        riscritture_dell_anagrafe: Arc<AtomicUsize>,
    }

    impl SupportoCheConta {
        fn nuovo() -> Self {
            SupportoCheConta {
                inner: crate::storage::MemStorage::new(),
                append_dell_anagrafe: Arc::new(AtomicUsize::new(0)),
                riscritture_dell_anagrafe: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    impl VaultStorage for SupportoCheConta {
        fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
            self.inner.read(path)
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<crate::storage::Stat> {
            if path.as_str().ends_with("entries.json") {
                self.riscritture_dell_anagrafe
                    .fetch_add(1, Ordering::Relaxed);
            }
            self.inner.write(path, bytes)
        }
        /// La compattazione passa di qui e non dalla `write`, perché si fonde
        /// con ciò che sul disco c'è adesso: a contare è la fusione che
        /// risponde con dei byte, cioè il file che cambia davvero — un
        /// aggiornamento che risponde «non scrivo» non è una scrittura.
        fn update(
            &self,
            path: &Utf8Path,
            fondi: crate::storage::Fusione<'_>,
        ) -> std::io::Result<()> {
            let anagrafe = path.as_str().ends_with("entries.json");
            let riscritture = Arc::clone(&self.riscritture_dell_anagrafe);
            let mut contando = move |vecchio: Option<&[u8]>| {
                let esito = fondi(vecchio);
                if anagrafe && matches!(esito, Ok(Some(_))) {
                    riscritture.fetch_add(1, Ordering::Relaxed);
                }
                esito
            };
            self.inner.update(path, &mut contando)
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
            if path.as_str().ends_with("entries.json") {
                self.append_dell_anagrafe.fetch_add(1, Ordering::Relaxed);
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
    fn sopravvive_a_un_giro_su_disco() {
        let (_tmp, root) = tempdir();
        let store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(store.known(&DocId::new("a.md")).is_none());
        store
            .store(BTreeMap::from([(DocId::new("a.md"), voce(3, 1_000))]))
            .expect("scrive");

        let riletta = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        let voce = riletta.known(&DocId::new("a.md")).expect("la ritrova");
        assert!(voce.describes(3, 1_000));
        assert!(!voce.describes(3, 1_001), "la data fa parte del criterio");
        assert!(!voce.describes(4, 1_000), "e la dimensione anche");
    }

    /// **Chi chiude per secondo non butta ciò che chi ha chiuso per primo aveva
    /// letto** (difetto 0189).
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
    #[test]
    fn chi_chiude_per_secondo_non_butta_le_impronte_di_chi_ha_letto() {
        let (_tmp, root) = tempdir();
        let fs = || Arc::new(crate::storage::FsStorage);
        let impronta = Revision::new("0123456789abcdef");

        // La seconda installazione apre **prima** che la prima abbia scritto:
        // ciò che scriverà alla chiusura è tutto ciò che sa, e non sa niente.
        let seconda = EntryStore::open(&root, fs());

        let prima = EntryStore::open(&root, fs());
        prima
            .store(BTreeMap::from([
                (
                    DocId::new("letta.md"),
                    StoredEntry {
                        fingerprint: Some(impronta.clone()),
                        ..voce(3, 1_000)
                    },
                ),
                (
                    DocId::new("cambiata.md"),
                    StoredEntry {
                        fingerprint: Some(impronta.clone()),
                        ..voce(3, 1_000)
                    },
                ),
                (DocId::new("sparita.md"), voce(9, 1_000)),
            ]))
            .expect("la prima chiude, e ha letto");

        seconda
            .store(BTreeMap::from([
                // Stesso file, stessa dimensione, stessa data: l'impronta che
                // non ha è ancora buona.
                (DocId::new("letta.md"), voce(3, 1_000)),
                // Lo stesso nome, ma il disco l'ha smentita: qui l'impronta
                // vecchia sarebbe una bugia scritta su disco.
                (DocId::new("cambiata.md"), voce(4, 1_100)),
            ]))
            .expect("la seconda chiude dopo, e non ha letto niente");

        let riletta = EntryStore::open(&root, fs());
        assert_eq!(
            riletta
                .known(&DocId::new("letta.md"))
                .and_then(|v| v.fingerprint.clone()),
            Some(impronta),
            "l'impronta di chi aveva letto è stata coperta da chi non aveva \
             letto: alla prossima apertura si rilegge e si riparsa un file che \
             nessuno ha toccato"
        );
        assert_eq!(
            riletta
                .known(&DocId::new("cambiata.md"))
                .and_then(|v| v.fingerprint.clone()),
            None,
            "un'impronta che il disco ha smentito non si tiene: sarebbe un \
             indice fermo su un contenuto che non c'è più"
        );
        assert!(
            riletta.known(&DocId::new("sparita.md")).is_none(),
            "la fusione ha risuscitato un file che la fotografia più recente \
             non ha: chi scrive ha appena camminato il vault, e sulla presenza \
             è lui l'autorità"
        );
        assert_eq!(
            seconda
                .known(&DocId::new("letta.md"))
                .and_then(|v| v.fingerprint.clone()),
            riletta
                .known(&DocId::new("letta.md"))
                .and_then(|v| v.fingerprint.clone()),
            "chi è rimasto aperto e chi riapre non vedono la stessa tabella: la \
             memoria dev'essere ciò che il disco ha accettato"
        );
    }

    #[test]
    fn una_tabella_illeggibile_non_e_un_avviso_e_non_blocca_niente() {
        // È la differenza con l'organizzazione (§11.3), che un file rotto lo
        // protegge: quello è autorevole, questo si rifà camminando il vault.
        let (_tmp, root) = tempdir();
        let path = data_root(&root).join(FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ non json").unwrap();

        let store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(store.known(&DocId::new("a.md")).is_none());
        store
            .store(BTreeMap::from([(DocId::new("a.md"), voce(1, 10))]))
            .expect("e la prima scrittura lo sostituisce senza chiedere permesso");
        assert!(EntryStore::open(&root, Arc::new(crate::storage::FsStorage))
            .known(&DocId::new("a.md"))
            .is_some());
    }

    /// **Una scrittura che non è avvenuta non si ricorda.**
    ///
    /// Il guasto non si aspetta, si inietta, e qui non serve nemmeno un
    /// supporto finto: `.fub/data` è un **file** invece che una cartella, cioè
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
    #[test]
    fn cio_che_il_disco_ha_rifiutato_non_resta_in_memoria() {
        let (_tmp, root) = tempdir();
        std::fs::create_dir_all(root.join(crate::vault::FUB_DIR)).unwrap();
        std::fs::write(data_root(&root), "non sono una cartella").unwrap();

        let store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        let e = store
            .store(BTreeMap::from([(DocId::new("a.md"), voce(3, 1_000))]))
            .expect_err("la cartella non si può creare");

        assert!(
            store.known(&DocId::new("a.md")).is_none(),
            "«{e}»: la memoria non deve raccontare una tabella che il disco non ha"
        );
        assert!(
            EntryStore::open(&root, Arc::new(crate::storage::FsStorage))
                .known(&DocId::new("a.md"))
                .is_none(),
            "e chi riapre la vede uguale a chi era rimasto aperto"
        );
    }

    /// L'anagrafe passa dal supporto, e ci passa **davvero**: su un supporto in
    /// memoria non deve restare niente sul disco. È la casella residua della
    /// 0064 vista da qui — un `std::fs` rimasto dentro questo modulo non fa
    /// fallire nessun test di conformità del trait, fa fallire questo.
    #[test]
    fn passa_dal_supporto_e_non_dal_disco() {
        let storage = Arc::new(crate::storage::MemStorage::new());
        let root = Utf8Path::new("/vault-anagrafe");
        let store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        store
            .store(BTreeMap::from([(DocId::new("a.md"), voce(3, 1_000))]))
            .expect("scrive");

        assert!(
            storage.exists(&data_root(root).join(FILE)),
            "la tabella è finita sul supporto"
        );
        assert!(
            !std::path::Path::new("/vault-anagrafe").exists(),
            "e non sul filesystem vero"
        );
        assert!(
            EntryStore::open(root, storage as Arc<dyn VaultStorage>)
                .known(&DocId::new("a.md"))
                .is_some(),
            "e si rilegge da lì"
        );
    }

    #[test]
    fn una_versione_che_non_si_conosce_si_butta() {
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
            "un derivato di una versione ignota non si indovina: si rifà"
        );
    }

    /// **Cambiare una voce su N appende il solo record, e non riscrive la
    /// tabella intera** (difetto 0112).
    ///
    /// Il difetto: `EntryStore::store` riserializzava e riscriveva l'intera
    /// `BTreeMap` a ogni voce cambiata, e su un vault grande il prezzo si
    /// pagava a ogni salvataggio. Il banco conta come l'anagrafe passa dal
    /// supporto: la prima scrittura è una fotografia (una riscrittura
    /// integrale, ed è giusto — il file non c'era), la seconda — una voce
    /// cambiata su mille — dev'essere **un'append sola e zero riscritture**.
    /// Con il formato di prima il banco è rosso: la seconda scrittura è una
    /// riscrittura integrale, e il conto delle append resta a zero.
    #[test]
    fn una_voce_cambiata_su_mille_appende_e_non_riscrive() {
        let storage = Arc::new(SupportoCheConta::nuovo());
        let root = Utf8Path::new("/vault-anagrafe");
        let store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);

        let mille: BTreeMap<_, _> = (0..1_000)
            .map(|i| (DocId::new(format!("nota{i:04}.md")), voce(i as u64, 1_000)))
            .collect();
        store
            .store(mille.clone())
            .expect("la prima scrittura: la fotografia, perché il file non c'era");

        let mut cambiata = mille.clone();
        cambiata.insert(DocId::new("nota0000.md"), voce(0, 1_001));
        store
            .store(cambiata)
            .expect("la seconda scrittura: una voce cambiata su mille");

        assert_eq!(
            storage.append_dell_anagrafe.load(Ordering::Relaxed),
            1,
            "il cambiamento è passato dal disco come un'append sola: il costo \
             di un salvataggio è il record di ciò che è cambiato, non la \
             tabella intera"
        );
        assert_eq!(
            storage.riscritture_dell_anagrafe.load(Ordering::Relaxed),
            1,
            "e la riscrittura integrale è rimasta quella della fotografia \
             iniziale: la seconda scrittura non ha riscritto la tabella"
        );

        // E la coda si rilegge: chi riapre vede la voce cambiata e le altre
        // novecentonovantanove ferme.
        let riletta = EntryStore::open(root, storage as Arc<dyn VaultStorage>);
        assert!(
            riletta
                .known(&DocId::new("nota0000.md"))
                .expect("la voce c'è")
                .describes(0, 1_001),
            "la voce cambiata è quella nuova"
        );
        assert!(
            riletta
                .known(&DocId::new("nota0001.md"))
                .expect("la voce c'è")
                .describes(1, 1_000),
            "e le altre sono rimaste quelle di prima"
        );
    }

    /// **Una coda troncata non fa rifiutare il resto** (§15.7): la riga rotta
    /// in coda si scarta, e ciò che viene prima si legge tutto. È la promessa
    /// che rende sicuro l'append senza atomicità — un crash a metà aggiunta
    /// lascia una riga rotta, non una tabella persa.
    #[test]
    fn una_coda_troncata_si_legge_fino_alla_riga_rotta() {
        let storage = Arc::new(SupportoCheConta::nuovo());
        let root = Utf8Path::new("/vault-anagrafe");
        let store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        store
            .store(BTreeMap::from([(DocId::new("a.md"), voce(1, 10))]))
            .expect("la fotografia");

        let path = data_root(root).join(FILE);
        let mut raw = storage.inner.read(&path).expect("la coda");
        raw.extend_from_slice(
            b"\n{\"v\":4,\"op\":\"upsert\",\"id\":\"b.md\",\"entry\":{\"size\":2,\"mtime\":20}",
        );
        storage.inner.write(&path, &raw).expect("il crash a metà");

        let riletta = EntryStore::open(root, storage as Arc<dyn VaultStorage>);
        assert!(
            riletta
                .known(&DocId::new("a.md"))
                .expect("la voce c'è")
                .describes(1, 10),
            "ciò che viene prima della riga rotta si è letto tutto"
        );
        assert!(
            riletta.known(&DocId::new("b.md")).is_none(),
            "e la riga rotta si è scartata, non indovinata"
        );
    }

    // La regola *racily clean* aveva qui il suo banco, e presidiava la soglia
    // sbagliata: «non anteriore alla **scrittura della tabella**». La soglia è
    // il momento dell'osservazione (difetto 0187), che questo modulo non vede —
    // fra l'una e l'altra ci sta una sessione intera —, e il banco è andato
    // dove la regola sta adesso: `anagrafe.rs`,
    // `una_data_che_puo_ancora_cambiare_non_finisce_in_anagrafe`.
}
