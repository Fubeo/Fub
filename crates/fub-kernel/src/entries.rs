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
//! Da lì la regola che git chiama *racily clean*: la tabella ricorda **quando è
//! stata scritta**, e ciò che ha una data maggiore o uguale a quella non si
//! crede mai. Costa la rilettura dei pochi file toccati nell'ultimo millisecondo
//! della scansione.

use std::collections::BTreeMap;
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::model::{Anchor, DocId, Frontmatter, Heading, Link};
use serde::{Deserialize, Serialize};

use crate::storage::VaultStorage;
use crate::vault::data_root;

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
const SCHEMA_VERSION: u32 = 2;

/// Il nome del file dentro [`data_root`].
const FILE: &str = "entries.json";

/// I metadati di un documento che l'anagrafe si ricorda: ciò che il kernel
/// avrebbe dovuto **rileggere e riparsare** il file per riavere.
///
/// Il **corpo** non c'è, come non c'è nella cache in memoria (`DocMeta`) e per
/// la stessa ragione: il render lo riparsa dal disco su richiesta, e tenerlo qui
/// vorrebbe dire scrivere l'intero vault una seconda volta accanto a sé stesso.
#[derive(Clone, Debug, Serialize, Deserialize)]
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
#[derive(Clone, Debug, Serialize, Deserialize)]
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
#[derive(Default, Serialize, Deserialize)]
struct EntriesFile {
    version: u32,
    /// Quando questa tabella è stata scritta, in millisecondi UNIX: è la soglia
    /// della regola *racily clean* (vedi il § in testa al modulo).
    #[serde(default)]
    written_at: u64,
    #[serde(default)]
    entries: BTreeMap<DocId, StoredEntry>,
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
    known: BTreeMap<DocId, StoredEntry>,
}

impl EntryStore {
    /// Apre la tabella di un vault. **Non fallisce mai**: ciò che non si legge
    /// non c'è, e ciò che non c'è si ricostruisce leggendo il vault — che è la
    /// definizione di dato derivato.
    pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {
        let path = data_root(root).join(FILE);
        EntryStore {
            known: load(&path, storage.as_ref()).unwrap_or_default(),
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
    pub(crate) fn store(&mut self, entries: BTreeMap<DocId, StoredEntry>) -> Result<(), String> {
        let written_at = crate::time::now_unix_millis();
        self.known = entries;
        let file = EntriesFile {
            version: SCHEMA_VERSION,
            written_at,
            // La copia c'è perché ciò che si scrive è ciò che si tiene: due
            // strutture diverse sarebbero due idee di cosa si sa.
            entries: self.known.clone(),
        };
        let json = serde_json::to_vec(&file).map_err(|e| e.to_string())?;
        // Le cartelle mancanti le crea il supporto, che è dove quella riga sta
        // scritta una volta sola (§15.1).
        self.storage
            .write(&self.path, &json)
            .map_err(|e| format!("non riesco a scrivere {}: {e}", self.path))
    }
}

/// Legge la tabella, applicando la regola *racily clean*.
///
/// `None` per tutto ciò che non è «un file nostro, di questa versione, leggibile
/// per intero»: un errore di I/O, un JSON rotto, una versione che non si
/// conosce. Nessuno dei tre è un avviso — sono tutti «ricomincia dal vault».
fn load(path: &Utf8Path, storage: &dyn VaultStorage) -> Option<BTreeMap<DocId, StoredEntry>> {
    let raw = storage.read(path).ok()?;
    let file: EntriesFile = serde_json::from_slice(&raw).ok()?;
    if file.version != SCHEMA_VERSION {
        return None;
    }
    Some(
        file.entries
            .into_iter()
            .filter(|(_, e)| e.mtime < file.written_at)
            .collect(),
    )
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

    #[test]
    fn cio_che_e_stato_scritto_mentre_scrivevamo_non_si_crede() {
        // La regola *racily clean*: un file salvato nello stesso istante in cui
        // la tabella si scriveva porterebbe una data che combacia e un
        // contenuto che non combacia più.
        let (_tmp, root) = tempdir();
        let mut store = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        let futuro = crate::time::now_unix_millis() + 60_000;
        store
            .store(BTreeMap::from([
                (DocId::new("vecchia.md"), voce(1, 1_000)),
                (DocId::new("appena-scritta.md"), voce(1, futuro)),
            ]))
            .expect("scrive");

        let riletta = EntryStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(riletta.known(&DocId::new("vecchia.md")).is_some());
        assert!(
            riletta.known(&DocId::new("appena-scritta.md")).is_none(),
            "una data non anteriore alla scrittura della tabella non si crede"
        );
    }
}
