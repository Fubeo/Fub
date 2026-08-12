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
//! - la scrittura è **atomica**, e lo è perché passa dal supporto (§15.1), che
//!   dalla [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)
//!   la dà a tutti: un file mezzo scritto è un
//!   file illeggibile, e un file illeggibile qui vuol dire una riapertura lenta
//!   — ma solo se non ci si è convinti di averlo letto.
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
use std::sync::Arc;

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
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(3);

/// Il nome del file dentro [`data_root`].
const FILE: &str = "entries.json";

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

/// Il file com'è su disco.
///
/// Generico sul solo campo che pesa, perché **scriverlo non costi una copia**:
/// si legge come [`EntriesFile`] (che possiede la tabella) e si scrive come
/// `EntriesFile<&BTreeMap<…>>`, che la presta. È una struttura sola, quindi non
/// c'è modo che le due idee del formato divergano — che è ciò che due tipi
/// gemelli, uno per leggere e uno per scrivere, non avrebbero garantito.
#[derive(Default, Serialize, Deserialize)]
struct EntriesFile<E = BTreeMap<DocId, StoredEntry>> {
    version: SchemaVersion,
    #[serde(default)]
    entries: E,
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
    known: Durevole<BTreeMap<DocId, StoredEntry>>,
}

impl EntryStore {
    /// Apre la tabella di un vault. **Non fallisce mai**: ciò che non si legge
    /// non c'è, e ciò che non c'è si ricostruisce leggendo il vault — che è la
    /// definizione di dato derivato.
    pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {
        let path = data_root(root).join(FILE);
        EntryStore {
            known: Durevole::letto(load(&path, storage.as_ref()).unwrap_or_default()),
            path,
            storage,
        }
    }

    /// Cosa si sapeva di questo file l'ultima volta.
    pub(crate) fn known(&self, id: &DocId) -> Option<&StoredEntry> {
        self.known.get(id)
    }

    /// **Tutto** ciò che si sapeva, per chi ha una domanda sull'insieme e non su
    /// un file.
    ///
    /// Ce n'è uno solo, di cliente, ed è il ricongiungimento delle rinomine
    /// fatte ad app chiusa (§23.1): la sua domanda — *cosa c'era ieri e non c'è
    /// oggi?* — non si può fare un id alla volta, perché l'id di ciò che è
    /// sparito non ce l'ha nessuno da nominare.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&DocId, &StoredEntry)> {
        self.known.iter()
    }

    /// Scrive la tabella e la tiene come «ciò che si sa».
    ///
    /// L'errore è una stringa e non risale: chi non riesce a scrivere una cache
    /// ha comunque aperto il vault, e far fallire un'apertura riuscita perché
    /// un file derivato non si è scritto sarebbe il verso sbagliato. Chi chiama
    /// lo annota dove si annotano gli altri esiti che nessuno leggerebbe.
    ///
    /// **Si scrive prima e si adotta dopo** ([`Durevole`]), e non è una
    /// preferenza sull'ordine: al contrario, una scrittura fallita lasciava
    /// `known` a raccontare una tabella che sul disco non c'è: dentro la
    /// sessione «ciò che si sa» e «ciò che si sa*rà* riaprendo» diventavano due
    /// cose diverse, e nessuno le teneva d'occhio perché l'esito non risale.
    /// Con l'ordine giusto un guasto costa ciò che un dato derivato deve
    /// costare — una riapertura lenta — e niente altro.
    pub(crate) fn store(&mut self, entries: BTreeMap<DocId, StoredEntry>) -> Result<(), String> {
        // **Una tabella che il disco ha già non si riscrive.** Da quando
        // l'anagrafe si scrive anche alla chiusura del vault, chi apre e chiude
        // senza toccare niente passa di qui due volte con lo stesso contenuto:
        // senza questa riga la seconda volta serializzerebbe e riscriverebbe una
        // riga per file del vault per non dire niente di nuovo.
        //
        // Il confronto è lecito **perché** `known` è un [`Durevole`]: dice ciò
        // che il disco ha accettato, non ciò che qualcuno si è annotato. Con un
        // campo normale questa riga sarebbe una scommessa — una scrittura
        // fallita avrebbe lasciato in memoria una tabella mai scritta, e il
        // confronto avrebbe saltato la scrittura che la ripara.
        if entries == *self.known {
            return Ok(());
        }
        let (path, storage) = (&self.path, self.storage.as_ref());
        self.known.scrivi(entries, |entries| {
            let json = serde_json::to_vec(&EntriesFile {
                version: SCHEMA_VERSION,
                entries,
            })
            .map_err(|e| e.to_string())?;
            // Le cartelle mancanti le crea il supporto, che è dove quella riga
            // sta scritta una volta sola (§15.1).
            storage
                .write(path, &json)
                .map(|_| ())
                .map_err(|e| format!("non riesco a scrivere {path}: {e}"))
        })
    }
}

/// Legge la tabella.
///
/// `None` per tutto ciò che non è «un file nostro, di questa versione, leggibile
/// per intero»: un errore di I/O, un JSON rotto, una versione che non si
/// conosce. Nessuno dei tre è un avviso — sono tutti «ricomincia dal vault».
///
/// Qui non c'è più nessun vaglio *racily clean*, e non perché la regola sia
/// caduta: è stata spostata dove si osserva, cioè al momento in cui una voce
/// entra in anagrafe (difetto 0187). Ciò che è scritto qui è già passato di lì.
fn load(path: &Utf8Path, storage: &dyn VaultStorage) -> Option<BTreeMap<DocId, StoredEntry>> {
    let raw = storage.read(path).ok()?;
    let file: EntriesFile = serde_json::from_slice(&raw).ok()?;
    if file.version != SCHEMA_VERSION {
        return None;
    }
    Some(file.entries)
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn sopravvive_a_un_giro_su_disco() {
        let (_tmp, root) = tempdir();
        let mut store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
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

    #[test]
    fn una_tabella_illeggibile_non_e_un_avviso_e_non_blocca_niente() {
        // È la differenza con l'organizzazione (§11.3), che un file rotto lo
        // protegge: quello è autorevole, questo si rifà camminando il vault.
        let (_tmp, root) = tempdir();
        let path = data_root(&root).join(FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ non json").unwrap();

        let mut store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
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
    /// «ciò che si sa» e «ciò che si saprà riaprendo» diventano due cose
    /// diverse per tutta la sessione. L'esito di `store` non risale a nessuno
    /// (è un derivato, apposta), quindi non c'era nemmeno chi potesse
    /// accorgersene.
    #[test]
    fn cio_che_il_disco_ha_rifiutato_non_resta_in_memoria() {
        let (_tmp, root) = tempdir();
        std::fs::create_dir_all(root.join(crate::vault::FUB_DIR)).unwrap();
        std::fs::write(data_root(&root), "non sono una cartella").unwrap();

        let mut store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
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
        let mut store = EntryStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
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

    // La regola *racily clean* aveva qui il suo banco, e presidiava la soglia
    // sbagliata: «non anteriore alla **scrittura della tabella**». La soglia è
    // il momento dell'osservazione (difetto 0187), che questo modulo non vede —
    // fra l'una e l'altra ci sta una sessione intera —, e il banco è andato
    // dove la regola sta adesso: `anagrafe.rs`,
    // `una_data_che_puo_ancora_cambiare_non_finisce_in_anagrafe`.
}
