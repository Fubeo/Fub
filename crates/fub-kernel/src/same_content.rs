//! **Lo stesso contenuto**: c'è già un file del vault con questi byte, anche con
//! un altro nome? (D-3 (b), A-17.)
//!
//! Il vault non sa dire «questo file c'è già» da un nome, e non deve: un
//! contenuto che arriva (un file trascinato, una copia incollata) si confronta
//! con ciò che il vault ha già, e se è uguale si riusa invece di riempire il
//! vault di copie.
//!
//! # Come si risponde
//!
//! 1. I **candidati** sono le voci della tabella (`.fub/data/entries.json`) con
//!    la misura che arriva, fuori dal cestino, da `.fub/` e dalle cartelle
//!    escluse: la stessa politica della scansione. Un file che la tabella non
//!    conosce ancora non è un candidato.
//! 2. Per ogni candidato si prende la sua **impronta**: quella registrata, se la
//!    voce descrive ancora il file; altrimenti si calcola leggendolo a pezzi.
//! 3. Un'impronta uguale non basta: **l'impronta sceglie, i byte decidono**. Il
//!    candidato si confronta byte per byte con ciò che arriva, e solo un
//!    confronto intero dà `Found`.
//!
//! # I limiti (A-17)
//!
//! [`MAX_CANDIDATES`] candidati e [`MAX_BYTES_READ`] byte letti per domanda sono
//! valori di partenza, costanti con nome. Oltre, o senza una tabella che si
//! legge, la risposta è `Unknown` e chi chiede copia: nel dubbio si copia.
//!
//! Un contenuto che arriva da un lettore si copia in memoria una volta sola,
//! entro lo stesso limite. Un contenuto già in memoria si confronta dove sta,
//! senza copia (vedi [`Vault::same_content_bytes`]).
//!
//! # Il file non cambia mentre lo si legge
//!
//! Un candidato conta solo se misura, data, timbro e identità sono gli stessi
//! prima e dopo la lettura. Un file cambiato a metà non conta, e la sua impronta
//! non si registra, come fa `enrich`. Il lucchetto del vault non si tiene mai
//! durante la lettura: la domanda prende le voci, le lascia, legge, e registra
//! solo ciò che ha ricontrollato.
//!
//! # Cosa non si segue
//!
//! Un candidato che oggi è un collegamento, o una cartella, non è un file: si
//! salta senza leggerlo. Lo storage è radicato, quindi nessuna lettura esce dal
//! vault.

use std::io::{self, Read};

use camino::Utf8Path;
use fub_abi::edit::Revision;
use fub_abi::model::DocId;

use crate::entries::{self, Observed, StoredEntry, TableFault};
use crate::error::{KernelError, Result};
use crate::ignore::Kind;
use crate::storage::VaultStorage;
use crate::vault::{sized_fingerprint_of, Vault};

/// Quante voci della stessa misura si confrontano al più per una domanda.
pub const MAX_CANDIDATES: usize = 64;

/// Quanti byte di candidati si leggono al più per una domanda, e la misura
/// massima del contenuto che arriva: oltre, la risposta è «non so».
pub const MAX_BYTES_READ: u64 = 512 * 1024 * 1024;

/// La risposta a «c'è già un file del vault con questi byte?».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SameContent {
    /// Un file del vault ha esattamente questi byte. Se ce ne sono più d'uno, è
    /// il primo per percorso.
    Found { id: DocId },
    /// Nessun candidato ha questi byte.
    NotFound,
    /// La risposta non si può dare: chi chiede copia.
    Unknown { reason: UnknownReason },
}

/// Perché la risposta è «non so».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnknownReason {
    /// Il vault non ha una tabella: non è mai stato indicizzato, o l'hanno tolta.
    NoTable,
    /// La tabella non si legge: il supporto ha dato questo errore.
    TableUnreadable(std::io::ErrorKind),
    /// La tabella non è una coda di questo formato, o non ha un record che si legga.
    TableBroken,
    /// La tabella porta record di un'altra versione di schema.
    TableOfAnotherVersion,
    /// Più di [`MAX_CANDIDATES`] voci della stessa misura.
    TooManyCandidates { found: usize },
    /// Il contenuto che arriva supera [`MAX_BYTES_READ`].
    TooLarge { bytes: u64 },
    /// Il budget di lettura di questa domanda è finito prima di una risposta.
    BudgetExhausted,
}

impl From<TableFault> for UnknownReason {
    fn from(fault: TableFault) -> Self {
        match fault {
            TableFault::Absent => UnknownReason::NoTable,
            TableFault::Unreadable(kind) => UnknownReason::TableUnreadable(kind),
            TableFault::Broken => UnknownReason::TableBroken,
            TableFault::ForeignVersion => UnknownReason::TableOfAnotherVersion,
        }
    }
}

/// La domanda di [`Vault::same_content`], con l'istante in cui comincia: la
/// regola *racily clean* confronta le date con questo istante.
pub(crate) fn find(
    vault: &Vault,
    bytes_len: u64,
    incoming: &mut dyn Read,
    started: u64,
) -> Result<SameContent> {
    find_within(vault, bytes_len, incoming, MAX_BYTES_READ, started)
}

/// La domanda di [`Vault::same_content_bytes`]: i byte sono già in memoria, e si
/// confrontano dove stanno, senza copia. Non c'è lettura che possa fallire.
pub(crate) fn find_bytes(vault: &Vault, wanted: &[u8], started: u64) -> SameContent {
    match plan(vault, wanted.len() as u64, MAX_BYTES_READ) {
        Plan::Settled(answer) => answer,
        Plan::Candidates(candidates) => {
            compare(vault, &candidates, wanted, MAX_BYTES_READ, started)
        }
    }
}

/// [`find`] con il budget esplicito, perché i test di unità provino i limiti
/// senza leggere 512 MiB.
fn find_within(
    vault: &Vault,
    bytes_len: u64,
    incoming: &mut dyn Read,
    budget: u64,
    started: u64,
) -> Result<SameContent> {
    let candidates = match plan(vault, bytes_len, budget) {
        Plan::Settled(answer) => return Ok(answer),
        Plan::Candidates(candidates) => candidates,
    };
    let wanted = read_incoming(incoming, bytes_len, vault.root())?;
    Ok(compare(vault, &candidates, &wanted, budget, started))
}

/// Quello che si decide senza leggere i byte che arrivano: o la risposta è già
/// data, o restano i candidati da confrontare.
enum Plan {
    Settled(SameContent),
    Candidates(Vec<(DocId, StoredEntry)>),
}

/// I candidati della stessa misura, fuori dal cestino, da `.fub/` e dalle
/// cartelle escluse, oppure la risposta, se non ce ne sono o non si possono
/// confrontare. Non legge nessun file.
fn plan(vault: &Vault, bytes_len: u64, budget: u64) -> Plan {
    let storage = vault.storage().as_ref();
    let same_size = match entries::same_size(vault.root(), storage, bytes_len) {
        Ok(same_size) => same_size,
        Err(fault) => return Plan::Settled(unknown(fault.into())),
    };
    let policy = vault.ignore_policy();
    let candidates: Vec<(DocId, StoredEntry)> = same_size
        .into_iter()
        .filter(|(id, _)| !policy.excludes_path(Utf8Path::new(id.as_str()), Kind::File))
        .collect();
    if candidates.is_empty() {
        // Nessun candidato: non c'è niente da leggere, e i byte che arrivano
        // restano dove sono.
        return Plan::Settled(SameContent::NotFound);
    }
    if candidates.len() > MAX_CANDIDATES {
        return Plan::Settled(unknown(UnknownReason::TooManyCandidates {
            found: candidates.len(),
        }));
    }
    if bytes_len > budget {
        return Plan::Settled(unknown(UnknownReason::TooLarge { bytes: bytes_len }));
    }
    Plan::Candidates(candidates)
}

/// Confronta i candidati, nell'ordine per percorso, con i byte della domanda: il
/// primo che li ha vince. L'impronta di ciò che arriva si calcola una volta sola.
fn compare(
    vault: &Vault,
    candidates: &[(DocId, StoredEntry)],
    wanted: &[u8],
    budget: u64,
    started: u64,
) -> SameContent {
    let revision = Revision::of_bytes(wanted);
    let mut budget = Budget(budget);
    for (id, stored) in candidates {
        match holds(vault, id, stored, &revision, wanted, &mut budget, started) {
            Ok(true) => return SameContent::Found { id: id.clone() },
            Ok(false) => {}
            Err(Spent) => return unknown(UnknownReason::BudgetExhausted),
        }
    }
    SameContent::NotFound
}

fn unknown(reason: UnknownReason) -> SameContent {
    SameContent::Unknown { reason }
}

/// Quanti byte di candidati si possono ancora leggere in questa domanda.
struct Budget(u64);

/// Il budget è finito: la domanda non si chiude più con una risposta.
struct Spent;

impl Budget {
    fn charge(&mut self, bytes: u64) -> std::result::Result<(), Spent> {
        if bytes > self.0 {
            return Err(Spent);
        }
        self.0 -= bytes;
        Ok(())
    }
}

/// Copia in memoria, una volta sola, i byte che arrivano da un lettore. Devono
/// essere esattamente quelli dichiarati: un contenuto più corto o più lungo è un
/// errore di chi chiede, non una risposta.
fn read_incoming(incoming: &mut dyn Read, bytes_len: u64, root: &Utf8Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    // Un byte in più basta a dire che il contenuto è più lungo di quanto
    // dichiarato. `bytes_len` è già sotto [`MAX_BYTES_READ`]: niente overflow.
    let read = incoming
        .take(bytes_len + 1)
        .read_to_end(&mut bytes)
        .map_err(|source| KernelError::Io {
            path: root.to_owned(),
            source,
        })?;
    if read as u64 != bytes_len {
        return Err(KernelError::Io {
            path: root.to_owned(),
            source: io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("il contenuto dichiarato era di {bytes_len} byte, ne sono arrivati {read}"),
            ),
        });
    }
    Ok(bytes)
}

/// Il candidato ha questi byte? `Err(Spent)` se la lettura che servirebbe
/// supera il budget.
///
/// Un candidato che non si legge, che non è più un file di questa misura, o che
/// cambia mentre lo si legge, non è né un sì né un no: si salta, e della sua
/// impronta non si registra niente.
fn holds(
    vault: &Vault,
    id: &DocId,
    stored: &StoredEntry,
    wanted: &Revision,
    wanted_bytes: &[u8],
    budget: &mut Budget,
    started: u64,
) -> std::result::Result<bool, Spent> {
    let storage = vault.storage().as_ref();
    let bytes_len = wanted_bytes.len() as u64;
    let Ok(path) = vault.path_for(id) else {
        return Ok(false);
    };
    let Some(now) = Observed::of(storage, &path).filter(|now| now.size == bytes_len) else {
        return Ok(false);
    };
    let fingerprint = match stored.fingerprint_for(&now) {
        Some(known) => known.clone(),
        None => {
            budget.charge(bytes_len)?;
            let Ok((computed, read)) = sized_fingerprint_of(storage, &path) else {
                return Ok(false);
            };
            if read != bytes_len || Observed::of(storage, &path).as_ref() != Some(&now) {
                return Ok(false);
            }
            if let Err(and) =
                entries::record_fingerprint(vault.root(), storage, id, &now, started, &computed)
            {
                tracing::warn!(target: "fub.kernel", id = id.as_str(), "impronta non registrata: {and}");
            }
            computed
        }
    };
    if fingerprint != *wanted {
        return Ok(false);
    }
    // L'impronta ha scelto il candidato: adesso decidono i byte.
    budget.charge(bytes_len)?;
    let Ok(equal) = bytes_equal(storage, &path, wanted_bytes) else {
        return Ok(false);
    };
    Ok(equal && Observed::of(storage, &path).as_ref() == Some(&now))
}

/// Il file ha esattamente questi byte, letti a pezzi? Un file più corto o più
/// lungo non lo ha.
fn bytes_equal(storage: &dyn VaultStorage, path: &Utf8Path, wanted: &[u8]) -> io::Result<bool> {
    let mut offset = 0usize;
    let mut equal = true;
    storage.read_pieces(path, &mut |piece| {
        let end = offset + piece.len();
        equal &= wanted.get(offset..end) == Some(piece);
        offset = end;
    })?;
    Ok(equal && offset == wanted.len())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{Duration, SystemTime};

    use serde_json::json;

    use super::*;
    use crate::time::now_unix_millis;
    use crate::vault::data_root;

    fn root_of(dir: &tempfile::TempDir) -> camino::Utf8PathBuf {
        camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("UTF-8")
    }

    /// Un file con la data nel passato, come la scrive un utente prima di aprire
    /// il vault.
    fn put(root: &Utf8Path, rel: &str, bytes: &[u8]) {
        let path = root.join(rel);
        fs::write(&path, bytes).expect("file");
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("apertura")
            .set_modified(SystemTime::now() - Duration::from_secs(3600))
            .expect("data nel passato");
    }

    /// Una tabella con uno snapshot delle voci `ids`, come le vede `vault`.
    fn table_of(vault: &Vault, ids: &[&str]) {
        let mut entries = serde_json::Map::new();
        for id in ids {
            let doc = DocId::new(*id);
            let (size, mtime) = vault.stat(&doc).expect("il file c'è");
            let mut value = json!({ "size": size, "mtime": mtime });
            if let Some(stamp) = vault.change_stamp(&doc) {
                value["change_stamp"] = json!(stamp);
            }
            if let Some(identity) = vault.file_identity(&doc) {
                value["identity"] = json!({ "volume": identity.volume, "file": identity.file });
            }
            entries.insert((*id).to_owned(), value);
        }
        let record = json!({ "v": 5, "op": "snapshot", "entries": entries });
        let mut raw = b"\n".to_vec();
        raw.extend(serde_json::to_vec(&record).expect("json"));
        raw.push(b'\n');
        let path = data_root(vault.root()).join("entries.json");
        fs::create_dir_all(path.parent().expect("cartella")).expect("cartella");
        fs::write(path, raw).expect("tabella");
    }

    fn table_bytes(root: &Utf8Path) -> Vec<u8> {
        fs::read(data_root(root).join("entries.json")).expect("la tabella")
    }

    #[test]
    fn the_budget_refuses_a_question_it_cannot_finish() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"abcd");
        let vault = Vault::open(&root).expect("vault");
        table_of(&vault, &["a.md"]);

        let answer = find_within(&vault, 4, &mut &b"zzzz"[..], 3, now_unix_millis());

        assert_eq!(
            answer.expect("la domanda riesce"),
            unknown(UnknownReason::TooLarge { bytes: 4 })
        );
    }

    #[test]
    fn the_budget_runs_out_between_two_candidates() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"abcd");
        put(&root, "b.md", b"efgh");
        let vault = Vault::open(&root).expect("vault");
        table_of(&vault, &["a.md", "b.md"]);

        // Il primo candidato si legge e consuma tutto il budget: il secondo non
        // ha più dove leggere, e la risposta resta «non so», non «no».
        let answer = find_within(&vault, 4, &mut &b"zzzz"[..], 4, now_unix_millis());

        assert_eq!(
            answer.expect("la domanda riesce"),
            unknown(UnknownReason::BudgetExhausted)
        );
    }

    #[test]
    fn a_fingerprint_is_recorded_only_when_the_file_is_older_than_the_question() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"abcd");
        let vault = Vault::open(&root).expect("vault");
        table_of(&vault, &["a.md"]);
        let mtime = vault.stat(&DocId::new("a.md")).expect("il file c'è").1;
        let before = table_bytes(&root);

        // La domanda comincia nello stesso millisecondo della data del file: la
        // data non è ancora nel passato, quindi non si crede e non si registra.
        let same_ms = find_within(&vault, 4, &mut &b"zzzz"[..], MAX_BYTES_READ, mtime);
        assert_eq!(same_ms.expect("la domanda riesce"), SameContent::NotFound);
        assert_eq!(
            table_bytes(&root),
            before,
            "nessuna riga per una data racily clean"
        );

        // Una domanda posteriore alla data la registra.
        let later = find_within(&vault, 4, &mut &b"zzzz"[..], MAX_BYTES_READ, mtime + 1);
        assert_eq!(later.expect("la domanda riesce"), SameContent::NotFound);
        let after = String::from_utf8(table_bytes(&root)).expect("testo");
        assert!(
            after.contains(&Revision::of_bytes(b"abcd").0),
            "l'impronta di abcd è registrata"
        );
    }
}
