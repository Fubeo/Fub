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
//! 1. I **candidati** sono le voci dell'**indice vivo** del workspace (l'anagrafe
//!    in memoria, `indexes.core.entries`) con la misura che arriva e la stessa
//!    estensione del nome che si vuole scrivere, senza badare a maiuscole e
//!    minuscole, fuori dal cestino, da `.fub/` e dalle cartelle escluse: la
//!    stessa politica della scansione. Non la tabella su disco
//!    (`.fub/data/entries.json`), che si scrive alla fine dell'indicizzazione e
//!    alla chiusura: un file scritto o cambiato nella sessione si ritrova
//!    subito. Un indice che non ha ancora finito la scansione non sa quali file
//!    ci sono, e la risposta è «non so».
//! 2. Per ogni candidato si prende la sua **impronta**: quella della voce, se
//!    misura e data del file sono ancora quelle della voce; altrimenti si calcola
//!    leggendolo a pezzi.
//! 3. Un'impronta uguale non basta: **l'impronta sceglie, i byte decidono**. Il
//!    candidato si confronta byte per byte con ciò che arriva, e solo un
//!    confronto intero dà `Found`.
//!
//! Un contenuto di 0 byte non si ritrova mai: due file vuoti non dicono niente
//! l'uno dell'altro, e la risposta è `NotFound` (si copia). Un `.txt` uguale a
//! una nota `.md` non è quella nota: il tipo fa parte di ciò che si riusa.
//!
//! # I limiti (A-17)
//!
//! [`MAX_CANDIDATES`] candidati e [`MAX_BYTES_READ`] byte letti per domanda sono
//! valori di partenza, costanti con nome. Oltre, la risposta è `Unknown` e chi
//! chiede copia: nel dubbio si copia. Il contenuto che arriva è già in memoria e
//! si confronta dove sta, senza copia.
//!
//! # Il file non cambia mentre lo si legge
//!
//! Un candidato conta solo se misura, data, timbro e identità sono gli stessi
//! prima e dopo la lettura. Un file cambiato a metà non conta, e la sua impronta
//! non si impara. Il lucchetto del workspace non si tiene mai durante la
//! lettura: la domanda prende i candidati sotto il lucchetto
//! ([`Workspace::prepare_same_content`](crate::Workspace::prepare_same_content)),
//! lo lascia, legge, e le impronte calcolate tornano all'indice vivo sotto il
//! suo lucchetto
//! ([`Workspace::learn_fingerprints`](crate::Workspace::learn_fingerprints)),
//! che le ricontrolla prima di tenerle. Su disco le porta l'anagrafe
//! (`EntryStore`) la prossima volta che si scrive: nessuno scrive la tabella
//! scavalcandola.
//!
//! # Cosa non si segue
//!
//! Un candidato che oggi è un collegamento, o una cartella, non è un file: si
//! salta senza leggerlo. Lo storage è radicato, quindi nessuna lettura esce dal
//! vault.

use std::io;

use camino::Utf8Path;
use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_abi::traits::VaultEntry;

use crate::ignore::{IgnorePolicy, Kind};
use crate::storage::{FileIdentity, VaultStorage};
use crate::vault::{sized_fingerprint_of, Vault};

/// Quante voci della stessa misura si confrontano al più per una domanda.
pub const MAX_CANDIDATES: usize = 64;

/// Quanti byte di candidati si leggono al più per una domanda, e la misura
/// massima del contenuto che arriva: oltre, la risposta è «non so».
pub const MAX_BYTES_READ: u64 = 512 * 1024 * 1024;

/// La risposta a «c'è già un file del vault con questi byte?».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SameContent {
    /// Un file del vault, dello stesso tipo, ha esattamente questi byte. Se ce
    /// ne sono più d'uno, è il primo per percorso.
    Found { id: DocId },
    /// Nessun candidato ha questi byte, o il contenuto è vuoto.
    NotFound,
    /// La risposta non si può dare: chi chiede copia.
    Unknown { reason: UnknownReason },
}

/// Perché la risposta è «non so».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnknownReason {
    /// L'indice vivo non ha ancora finito la scansione: non sa quali file ci
    /// sono.
    IndexNotReady,
    /// Più di [`MAX_CANDIDATES`] voci della stessa misura e dello stesso tipo.
    TooManyCandidates { found: usize },
    /// Il contenuto che arriva supera [`MAX_BYTES_READ`].
    TooLarge { bytes: u64 },
    /// Il budget di lettura di questa domanda è finito prima di una risposta.
    BudgetExhausted,
}

/// Una voce dell'indice vivo che potrebbe avere questi byte, come l'indice la
/// conosceva quando si è preparata la domanda.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub(crate) id: DocId,
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    pub(crate) fingerprint: Option<Revision>,
    /// Il file su cui l'impronta è stata imparata da una domanda, se è così
    /// che la voce l'ha avuta: l'impronta vale solo per quel file.
    pub(crate) witness: Option<FileWitness>,
}

/// **Quale file**, oltre a misura e data: il segno del cambio e l'identità
/// che il supporto dà per un path, letti senza aprire il file.
///
/// Due testimoni dicono lo stesso file se **ogni campo che entrambi conoscono
/// coincide** ([`FileWitness::agrees`]). Un campo che uno dei due non conosce
/// non decide, né in un verso né nell'altro: un supporto che non sa dare il
/// segno (una memoria, un archivio) o una riga scritta prima che lo si
/// registrasse non bloccano per sempre l'impronta, e il «sì» lo danno
/// comunque i byte. La regola è una per il segno e per l'identità.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FileWitness {
    pub(crate) change_stamp: Option<u64>,
    pub(crate) identity: Option<FileIdentity>,
}

impl FileWitness {
    /// Il testimone di `id` adesso, come lo dà il supporto del vault.
    pub(crate) fn of(vault: &Vault, id: &DocId) -> FileWitness {
        FileWitness {
            change_stamp: vault.change_stamp(id),
            identity: vault.file_identity(id),
        }
    }

    /// Dicono lo stesso file? Vedi il tipo: ogni campo noto a entrambi deve
    /// coincidere, uno ignoto da una parte non decide.
    pub(crate) fn agrees(&self, other: &FileWitness) -> bool {
        fn same<T: PartialEq>(a: &Option<T>, b: &Option<T>) -> bool {
            match (a, b) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            }
        }
        same(&self.change_stamp, &other.change_stamp) && same(&self.identity, &other.identity)
    }
}

/// Quello che si decide sotto il lucchetto, senza leggere niente: o la risposta
/// è già data, o restano i candidati da confrontare.
#[derive(Debug)]
pub(crate) enum Plan {
    Settled(SameContent),
    Candidates(Vec<Candidate>),
}

/// Un'impronta calcolata da una domanda, da riportare all'indice vivo: vale
/// per la voce `id` solo se la voce ha ancora `size` e `mtime`, se `mtime` è
/// strettamente anteriore a `observed_at` (la regola *racily clean*). Il
/// `witness` è il file letto, preso fuori dal lucchetto mentre si calcolava
/// l'impronta: l'indice lo tiene accanto all'impronta, e chi la usa dopo (la
/// domanda seguente, l'anagrafe che la scrive) la crede solo per quel file.
/// Vedi [`Workspace::learn_fingerprints`](crate::Workspace::learn_fingerprints).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Learned {
    pub(crate) id: DocId,
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    pub(crate) witness: FileWitness,
    pub(crate) observed_at: u64,
    pub(crate) fingerprint: Revision,
}

/// Le impronte che una domanda ha calcolato leggendo i candidati. Si
/// consegnano a [`Workspace::learn_fingerprints`](crate::Workspace::learn_fingerprints),
/// che le tiene solo per le voci che descrivono ancora quei file.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LearnedFingerprints(pub(crate) Vec<Learned>);

impl LearnedFingerprints {
    /// Vero se la domanda non ha calcolato nessuna impronta: allora non c'è
    /// niente da riportare, e il lucchetto del workspace non serve.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// La risposta di una domanda, e le impronte che ha imparato per strada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SameContentOutcome {
    pub answer: SameContent,
    pub learned: LearnedFingerprints,
}

/// Ciò che si vede di un file **senza** leggerne i byte: il metro con cui si
/// decide se un candidato è cambiato mentre lo si leggeva.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Observed {
    size: u64,
    mtime: u64,
    witness: FileWitness,
}

impl Observed {
    /// Che cosa dice il supporto di `path` adesso, o `None` se lì non c'è un
    /// file semplice, o se una delle sue domande non ha risposta.
    ///
    /// `None` è «non so» e non «non c'è»: chi chiede salta il candidato. Un
    /// collegamento non è un file, e non si segue: lo storage è radicato, e
    /// nessuna lettura deve uscire dal vault.
    fn of(storage: &dyn VaultStorage, path: &Utf8Path) -> Option<Observed> {
        let stat = storage
            .stat_no_follow(path)
            .ok()
            .filter(|stat| stat.is_file())?;
        Some(Observed {
            size: stat.size,
            mtime: stat.mtime,
            witness: FileWitness {
                change_stamp: storage.change_stamp(path).ok()?,
                identity: storage.file_identity(path).ok()?,
            },
        })
    }
}

/// L'estensione del nome di `id`, in minuscolo e senza il punto: `None` per un
/// file che non ne ha (`LICENSE`) e per uno che è **solo** estensione
/// (`.gitignore`), dove il punto iniziale non separa un nome da un tipo. La
/// stessa regola di `fub_abi::rules::media`.
///
/// Due nomi sono dello stesso tipo se queste estensioni sono **uguali**, e
/// basta: il registro non si interroga, quindi `.md` e `.markdown` sono due
/// tipi anche se un formato li servisse entrambi. È prudente di proposito:
/// chi riusa un file scrive un collegamento a lui, e quel collegamento non
/// deve avere un'estensione diversa da quella del nome che si voleva.
fn extension_of(id: &str) -> Option<String> {
    let name = id.rsplit('/').next().unwrap_or(id);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => Some(ext.to_lowercase()),
        _ => None,
    }
}

/// I candidati per un contenuto di `bytes_len` byte da scrivere come `target`,
/// presi dalle voci dell'indice vivo, oppure la risposta, se non ce ne sono o
/// non si possono confrontare. Non legge nessun file: si chiama sotto il
/// lucchetto del workspace.
pub(crate) fn plan<'a>(
    entries: impl IntoIterator<Item = &'a VaultEntry>,
    witness_of: impl Fn(&DocId) -> Option<FileWitness>,
    ready: bool,
    policy: &IgnorePolicy,
    target: &DocId,
    bytes_len: u64,
) -> Plan {
    plan_within(
        entries,
        witness_of,
        ready,
        policy,
        target,
        bytes_len,
        MAX_BYTES_READ,
    )
}

/// [`plan`] con il budget esplicito, perché i test di unità provino i limiti
/// senza leggere 512 MiB.
fn plan_within<'a>(
    entries: impl IntoIterator<Item = &'a VaultEntry>,
    witness_of: impl Fn(&DocId) -> Option<FileWitness>,
    ready: bool,
    policy: &IgnorePolicy,
    target: &DocId,
    bytes_len: u64,
    budget: u64,
) -> Plan {
    if !ready {
        return Plan::Settled(unknown(UnknownReason::IndexNotReady));
    }
    if bytes_len == 0 {
        // Un contenuto vuoto non è mai «già nel vault»: si copia.
        return Plan::Settled(SameContent::NotFound);
    }
    let extension = extension_of(target.as_str());
    let candidates: Vec<Candidate> = entries
        .into_iter()
        .filter(|entry| entry.size == bytes_len)
        .filter(|entry| extension_of(entry.id.as_str()) == extension)
        .filter(|entry| !policy.excludes_path(Utf8Path::new(entry.id.as_str()), Kind::File))
        .map(|entry| Candidate {
            id: entry.id.clone(),
            size: entry.size,
            mtime: entry.mtime,
            fingerprint: entry.fingerprint.clone(),
            witness: witness_of(&entry.id),
        })
        .collect();
    if candidates.is_empty() {
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

/// La domanda preparata, fuori dal lucchetto: legge i candidati e confronta.
/// L'istante della domanda è quello dell'orologio del vault, lo stesso con cui
/// l'anagrafe giudica le date dei file.
pub(crate) fn answer(vault: &Vault, plan: Plan, wanted: &[u8]) -> SameContentOutcome {
    let started = vault.now_unix_millis();
    answer_within(vault, plan, wanted, MAX_BYTES_READ, started)
}

fn answer_within(
    vault: &Vault,
    plan: Plan,
    wanted: &[u8],
    budget: u64,
    started: u64,
) -> SameContentOutcome {
    match plan {
        Plan::Settled(answer) => SameContentOutcome {
            answer,
            learned: LearnedFingerprints::default(),
        },
        Plan::Candidates(candidates) => compare(vault, &candidates, wanted, budget, started),
    }
}

/// Confronta i candidati, nell'ordine per percorso, con i byte della domanda: il
/// primo che li ha vince. L'impronta di ciò che arriva si calcola una volta sola.
fn compare(
    vault: &Vault,
    candidates: &[Candidate],
    wanted: &[u8],
    budget: u64,
    started: u64,
) -> SameContentOutcome {
    let revision = Revision::of_bytes(wanted);
    let mut budget = Budget(budget);
    let mut learned = Vec::new();
    let mut answer = SameContent::NotFound;
    for candidate in candidates {
        match holds(
            vault,
            candidate,
            &revision,
            wanted,
            &mut budget,
            started,
            &mut learned,
        ) {
            Ok(true) => {
                answer = SameContent::Found {
                    id: candidate.id.clone(),
                };
                break;
            }
            Ok(false) => {}
            Err(Spent) => {
                answer = unknown(UnknownReason::BudgetExhausted);
                break;
            }
        }
    }
    SameContentOutcome {
        answer,
        learned: LearnedFingerprints(learned),
    }
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

/// Il candidato ha questi byte? `Err(Spent)` se la lettura che servirebbe
/// supera il budget.
///
/// Un candidato che non si legge, che non è più un file di questa misura, o che
/// cambia mentre lo si legge, non è né un sì né un no: si salta, e della sua
/// impronta non si impara niente.
fn holds(
    vault: &Vault,
    candidate: &Candidate,
    wanted: &Revision,
    wanted_bytes: &[u8],
    budget: &mut Budget,
    started: u64,
    learned: &mut Vec<Learned>,
) -> std::result::Result<bool, Spent> {
    let storage = vault.storage().as_ref();
    let bytes_len = wanted_bytes.len() as u64;
    let Ok(path) = vault.path_for(&candidate.id) else {
        return Ok(false);
    };
    let Some(now) = Observed::of(storage, &path).filter(|now| now.size == bytes_len) else {
        return Ok(false);
    };
    // L'impronta della voce si crede finché misura e data sono quelle della
    // voce, finché è nella forma corrente ([`Revision::is_current_form`]: una
    // FNV-1a di una tabella scritta prima di SHA-256 non è mai uguale, ma non
    // dice che i byte sono altri, e si ricalcola) e, se una domanda l'ha
    // imparata, finché il file è quello su cui l'ha imparata: il testimone si
    // confronta con quello appena letto, senza un'altra domanda al supporto.
    // Una voce vecchia con la stessa misura e la
    // stessa data può solo far dire «no» a torto, cioè copiare: il «sì» lo
    // danno sempre i byte.
    let known = candidate.fingerprint.as_ref().filter(|known| {
        now.size == candidate.size
            && now.mtime == candidate.mtime
            && known.is_current_form()
            && candidate
                .witness
                .is_none_or(|witness| witness.agrees(&now.witness))
    });
    let fingerprint = match known {
        Some(known) => known.clone(),
        None => {
            budget.charge(bytes_len)?;
            let Ok((computed, read)) = sized_fingerprint_of(storage, &path) else {
                return Ok(false);
            };
            if read != bytes_len || Observed::of(storage, &path).as_ref() != Some(&now) {
                return Ok(false);
            }
            learned.push(Learned {
                id: candidate.id.clone(),
                size: now.size,
                mtime: now.mtime,
                witness: now.witness,
                observed_at: started,
                fingerprint: computed.clone(),
            });
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

    use fub_abi::traits::EntryKind;

    use super::*;

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

    /// Le voci dell'indice vivo per `ids`, come le vede `vault`.
    fn entries_of(vault: &Vault, ids: &[&str]) -> Vec<VaultEntry> {
        ids.iter()
            .map(|id| {
                let doc = DocId::new(*id);
                let (size, mtime) = vault.stat(&doc).expect("il file c'è");
                VaultEntry {
                    id: doc,
                    kind: EntryKind::Document,
                    size,
                    mtime,
                    fingerprint: None,
                }
            })
            .collect()
    }

    fn plan_for(
        vault: &Vault,
        entries: &[VaultEntry],
        target: &str,
        len: u64,
        budget: u64,
    ) -> Plan {
        plan_within(
            entries,
            |_| None,
            true,
            &vault.ignore_policy(),
            &DocId::new(target),
            len,
            budget,
        )
    }

    #[test]
    fn after_a_budget_exhausted_the_fingerprints_learned_take_a_second_question_further() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.bin", b"aaaa");
        put(&root, "b.bin", b"bbbb");
        put(&root, "c.bin", b"cccc");
        let vault = Vault::open(&root).expect("vault");
        let mut entries = entries_of(&vault, &["a.bin", "b.bin", "c.bin"]);
        let ask = |entries: &[VaultEntry], learned: &[Learned]| {
            let plan = plan_within(
                entries,
                |id| {
                    learned
                        .iter()
                        .find(|learned| learned.id == *id)
                        .map(|learned| learned.witness)
                },
                true,
                &vault.ignore_policy(),
                &DocId::new("nuovo.bin"),
                4,
                8,
            );
            answer_within(&vault, plan, b"cccc", 8, u64::MAX)
        };

        // Il primo giro legge «a» e «b» per prenderne l'impronta, e il budget
        // finisce prima di «c»: «non so», ma due impronte imparate.
        let first = ask(&entries, &[]);
        assert_eq!(first.answer, unknown(UnknownReason::BudgetExhausted));
        assert_eq!(first.learned.0.len(), 2);

        // Con le impronte nell'indice il giro dopo non rilegge «a» e «b», e il
        // budget basta per «c»: è perché l'host ne fa uno, e uno solo.
        for learned in &first.learned.0 {
            let entry = entries
                .iter_mut()
                .find(|entry| entry.id == learned.id)
                .expect("la voce imparata");
            entry.fingerprint = Some(learned.fingerprint.clone());
        }
        let second = ask(&entries, &first.learned.0);
        assert_eq!(
            second.answer,
            SameContent::Found {
                id: DocId::new("c.bin")
            }
        );
    }

    #[test]
    fn a_witness_field_decides_only_when_both_sides_know_it() {
        let id = |file| Some(FileIdentity { volume: 1, file });
        let full = FileWitness {
            change_stamp: Some(10),
            identity: id(7),
        };
        // Lo stesso file, e due file diversi per un campo o per l'altro.
        assert!(full.agrees(&full));
        assert!(!full.agrees(&FileWitness {
            change_stamp: Some(11),
            ..full
        }));
        assert!(!full.agrees(&FileWitness {
            identity: id(8),
            ..full
        }));
        // Un campo che una parte non conosce non decide, per il segno come per
        // l'identità, e nei due versi: una riga senza segno non blocca
        // l'impronta per sempre.
        let no_stamp = FileWitness {
            change_stamp: None,
            ..full
        };
        let no_identity = FileWitness {
            identity: None,
            ..full
        };
        for partial in [no_stamp, no_identity, FileWitness::default()] {
            assert!(full.agrees(&partial), "{partial:?}");
            assert!(partial.agrees(&full), "{partial:?}");
        }
        // Ma ciò che è noto decide anche accanto a un campo ignoto.
        assert!(!no_stamp.agrees(&FileWitness {
            change_stamp: None,
            identity: id(8),
        }));
        assert!(!no_identity.agrees(&FileWitness {
            change_stamp: Some(11),
            identity: None,
        }));
    }

    #[test]
    fn the_extension_ignores_case_and_folders() {
        assert_eq!(extension_of("a/FOTO.PNG"), Some("png".to_owned()));
        assert_eq!(extension_of("cartella.d/LICENSE"), None);
        assert_eq!(extension_of(".gitignore"), None);
        assert_eq!(extension_of("nota."), None);
        assert_eq!(extension_of("archivio.tar.GZ"), Some("gz".to_owned()));
    }

    #[test]
    fn an_index_that_is_not_ready_does_not_know() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"abcd");
        let vault = Vault::open(&root).expect("vault");
        let entries = entries_of(&vault, &["a.md"]);

        let plan = plan_within(
            &entries,
            |_| None,
            false,
            &vault.ignore_policy(),
            &DocId::new("b.md"),
            4,
            MAX_BYTES_READ,
        );

        assert!(
            matches!(plan, Plan::Settled(ref answer) if *answer == unknown(UnknownReason::IndexNotReady)),
            "{plan:?}"
        );
    }

    #[test]
    fn the_budget_refuses_a_question_it_cannot_finish() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"abcd");
        let vault = Vault::open(&root).expect("vault");
        let entries = entries_of(&vault, &["a.md"]);

        let plan = plan_for(&vault, &entries, "b.md", 4, 3);
        let outcome = answer_within(&vault, plan, b"zzzz", 3, crate::time::now_unix_millis());

        assert_eq!(
            outcome.answer,
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
        let entries = entries_of(&vault, &["a.md", "b.md"]);

        // Il primo candidato si legge e consuma tutto il budget: il secondo non
        // ha più dove leggere, e la risposta resta «non so», non «no».
        let plan = plan_for(&vault, &entries, "c.md", 4, 4);
        let outcome = answer_within(&vault, plan, b"zzzz", 4, crate::time::now_unix_millis());

        assert_eq!(outcome.answer, unknown(UnknownReason::BudgetExhausted));
    }

    #[test]
    fn ten_thousand_candidates_are_unknown_without_reading_a_file() {
        // Nessun file sul disco: se il limite si controllasse dopo le letture, la
        // risposta sarebbe un candidato saltato e non un «non so».
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        let vault = Vault::open(&root).expect("vault");
        let entries: Vec<VaultEntry> = (0..10_000)
            .map(|i| VaultEntry {
                id: DocId::new(format!("molti/f{i:05}.md")),
                kind: EntryKind::Document,
                size: 4,
                mtime: 1,
                fingerprint: None,
            })
            .collect();

        let plan = plan_for(&vault, &entries, "z.md", 4, MAX_BYTES_READ);

        assert!(
            matches!(
                plan,
                Plan::Settled(SameContent::Unknown {
                    reason: UnknownReason::TooManyCandidates { found: 10_000 }
                })
            ),
            "{plan:?}"
        );
    }

    #[test]
    fn a_known_fingerprint_is_believed_but_the_bytes_decide() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"ciao!");
        let vault = Vault::open(&root).expect("vault");
        let mut entries = entries_of(&vault, &["a.md"]);
        // Un'impronta falsa, uguale a quella di ciò che arriva (stessa misura): la
        // voce descrive il file, quindi l'impronta si crede, non si rilegge niente
        // per lei, e il confronto dei byte dice no.
        entries[0].fingerprint = Some(Revision::of_bytes(b"altr!"));
        let plan = plan_for(&vault, &entries, "b.md", 5, MAX_BYTES_READ);
        let outcome = answer_within(&vault, plan, b"altr!", MAX_BYTES_READ, u64::MAX);
        assert_eq!(outcome.answer, SameContent::NotFound);
        assert!(
            outcome.learned.is_empty(),
            "un'impronta creduta non si impara"
        );

        // Con l'impronta giusta la stessa voce risponde: il controllo positivo.
        entries[0].fingerprint = Some(Revision::of_bytes(b"ciao!"));
        let plan = plan_for(&vault, &entries, "b.md", 5, MAX_BYTES_READ);
        let outcome = answer_within(&vault, plan, b"ciao!", MAX_BYTES_READ, u64::MAX);
        assert_eq!(
            outcome.answer,
            SameContent::Found {
                id: DocId::new("a.md")
            }
        );
    }

    #[test]
    fn a_fingerprint_of_an_older_form_is_computed_again() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"ciao!");
        let vault = Vault::open(&root).expect("vault");
        let mut entries = entries_of(&vault, &["a.md"]);
        // La voce viene da una tabella scritta prima di SHA-256: la sua impronta
        // è la FNV-1a a 16 cifre **degli stessi byte**. Non è uguale a quella di
        // ciò che arriva, ma non dice che i byte sono altri: si ricalcola.
        let legacy = format!("{:016x}", fub_abi::edit::Fnv1a::hash(b"ciao!"));
        entries[0].fingerprint = Some(Revision::new(legacy));
        let mtime = entries[0].mtime;
        let plan = plan_for(&vault, &entries, "b.md", 5, MAX_BYTES_READ);
        let outcome = answer_within(&vault, plan, b"ciao!", MAX_BYTES_READ, mtime + 1);
        assert_eq!(
            outcome.answer,
            SameContent::Found {
                id: DocId::new("a.md")
            }
        );
        assert_eq!(
            outcome.learned,
            LearnedFingerprints(vec![Learned {
                id: DocId::new("a.md"),
                size: 5,
                mtime,
                witness: FileWitness::of(&vault, &DocId::new("a.md")),
                observed_at: mtime + 1,
                fingerprint: Revision::of_bytes(b"ciao!"),
            }]),
            "l'impronta nella forma corrente torna all'indice"
        );
    }

    #[test]
    fn a_fingerprint_is_learned_with_the_instant_of_the_question() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"abcd");
        let vault = Vault::open(&root).expect("vault");
        let entries = entries_of(&vault, &["a.md"]);
        let mtime = entries[0].mtime;

        let plan = plan_for(&vault, &entries, "b.md", 4, MAX_BYTES_READ);
        let outcome = answer_within(&vault, plan, b"zzzz", MAX_BYTES_READ, mtime + 1);

        assert_eq!(outcome.answer, SameContent::NotFound);
        assert_eq!(
            outcome.learned,
            LearnedFingerprints(vec![Learned {
                id: DocId::new("a.md"),
                size: 4,
                mtime,
                witness: FileWitness::of(&vault, &DocId::new("a.md")),
                observed_at: mtime + 1,
                fingerprint: Revision::of_bytes(b"abcd"),
            }])
        );
    }
}
