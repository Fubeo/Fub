//! Le letture a pezzi di `fub.craft`, sopra le lease del kernel.
//!
//! Il bundle prende il [`ResourceReader`] del vault quando si registra
//! (`Registrar::craft_reader`) e con quello apre una lease e legge un pezzo
//! alla volta, senza mai prendere il lucchetto del workspace: un comando gira
//! già col suo `HostApi`, e un secondo lucchetto sullo stesso `RwLock` dallo
//! stesso thread può bloccarsi.
//!
//! Tre forme:
//!
//! - [`RangedFile`], `Read + Seek` sopra una lease, a pezzi di
//!   [`CHUNK_BYTES`], che conta i byte letti dal disco: per chi legge solo
//!   l'indice e una voce di un contenitore;
//! - [`Ranged::read_all`], il file intero a pezzi fino a un tetto, con la
//!   revisione calcolata sugli stessi pezzi con [`RevisionHasher`], la stessa
//!   di `document_revision`;
//! - [`Ranged::revision`], la sola revisione, letta a pezzi quando serve e
//!   ricordata finché una lease nuova dice che il file è lo stesso.
//!
//! Il kernel ricontrolla stat, identità e timbro di cambiamento prima e dopo
//! ogni pezzo: un file cambiato fra due pezzi è [`RangedError::Stale`] (in un
//! `io::Error` lo riconosce [`is_stale`]), mai byte di due versioni insieme.

use std::collections::HashMap;
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::{Revision, RevisionHasher};
use fub_kernel::storage::{FileIdentity, Stat};
use fub_kernel::transfer::ResourceLease;
use fub_kernel::workspace::ResourceReader;
use fub_kernel::KernelError;

/// Quanti byte si chiedono al kernel per volta.
pub const CHUNK_BYTES: usize = 256 * 1024;
/// Quante revisioni ricorda il processo; piena, la memoria si svuota.
pub const REMEMBERED_REVISIONS: usize = 4096;

/// Perché una lettura a pezzi non ha dato i byte.
#[derive(Debug)]
pub enum RangedError {
    /// Il file è cambiato dall'apertura della lease: si riprova con una
    /// lease nuova.
    Stale,
    /// Il file supera il tetto chiesto e non se n'è letto niente.
    OverLimit { bytes: u64, limit: u64 },
    /// Il kernel ha rifiutato l'apertura o il pezzo: un nome fuori dal vault,
    /// un file sparito, un supporto senza identità o timbro, un vault chiuso.
    Kernel(KernelError),
}

impl From<KernelError> for RangedError {
    fn from(error: KernelError) -> Self {
        match error {
            KernelError::Stale(_) => RangedError::Stale,
            other => RangedError::Kernel(other),
        }
    }
}

/// Il segno di un pezzo `Stale` dentro un `io::Error` di [`RangedFile`].
#[derive(Debug)]
struct StaleRead;

impl std::fmt::Display for StaleRead {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("stale")
    }
}

impl std::error::Error for StaleRead {}

/// `error` viene da un pezzo di un file cambiato dall'apertura della lease?
pub fn is_stale(error: &io::Error) -> bool {
    error.get_ref().is_some_and(|inner| inner.is::<StaleRead>())
}

fn io_of(error: KernelError) -> io::Error {
    match error {
        KernelError::Stale(_) => io::Error::other(StaleRead),
        other => io::Error::other(other),
    }
}

/// Il file intero, coi byte e la revisione degli stessi pezzi.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Whole {
    pub bytes: Vec<u8>,
    pub revision: Revision,
}

/// Le letture a pezzi di un vault: il lettore del kernel e niente altro.
#[derive(Clone)]
pub struct Ranged {
    reader: ResourceReader,
    /// I byte chiesti al kernel da ogni file aperto da qui, anche dalle
    /// copie di questo lettore.
    read: Arc<AtomicU64>,
}

impl Ranged {
    pub fn new(reader: ResourceReader) -> Self {
        Ranged {
            reader,
            read: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Una lease su `doc`: il peso viene da lì (`lease.stat.size`), non
    /// dall'elenco della cartella.
    pub fn open(&self, doc: &DocId) -> Result<RangedFile<'_>, RangedError> {
        let lease = self.reader.open(doc)?;
        let mut file = RangedFile::new(&self.reader, lease);
        file.total = Some(Arc::clone(&self.read));
        Ok(file)
    }

    /// I byte chiesti al kernel dai file aperti con questo lettore e con le
    /// sue copie.
    pub fn bytes_read(&self) -> u64 {
        self.read.load(Ordering::Relaxed)
    }

    /// La revisione di `doc` se è ricordata per la lease di adesso, senza
    /// leggere niente; `None` anche quando la lease non si apre.
    pub fn remembered(&self, doc: &DocId) -> Option<Revision> {
        remembered(&self.open(doc).ok()?.lease)
    }

    /// Il file intero, a pezzi, fino a `max` byte: oltre è
    /// [`RangedError::OverLimit`] senza leggere niente.
    pub fn read_all(&self, doc: &DocId, max: u64) -> Result<Whole, RangedError> {
        self.open(doc)?.read_whole(max)
    }

    /// La revisione di `doc`, a pezzi e fino a `max` byte.
    ///
    /// Ricordata per `(radice, doc)` finché una lease nuova ha la stessa
    /// identità, lo stesso `stat` e lo stesso timbro di cambiamento: la
    /// formula con cui il kernel dice che una lease vale ancora. Un file
    /// riscritto con lo stesso peso e la stessa data ha un timbro nuovo, e la
    /// revisione si rifà; il timbro però ha la grana dell'orologio del
    /// filesystem (su Linux un tick del kernel), e una riscrittura dello
    /// stesso peso nello stesso tick non la distingue nemmeno il kernel.
    pub fn revision(&self, doc: &DocId, max: u64) -> Result<Revision, RangedError> {
        let mut file = self.open(doc)?;
        if let Some(revision) = remembered(&file.lease) {
            return Ok(revision);
        }
        file.read_revision(max)
    }
}

/// `Read + Seek` sopra una lease, un pezzo di al più [`CHUNK_BYTES`] alla
/// volta. Tiene l'ultimo pezzo letto, così chi legge pochi byte per volta non
/// chiede un pezzo al kernel per ognuno; un pezzo chiesto dopo un cambiamento
/// del file è un `io::Error` che [`is_stale`] riconosce.
pub struct RangedFile<'a> {
    reader: &'a ResourceReader,
    lease: ResourceLease,
    pos: u64,
    window: Vec<u8>,
    window_start: u64,
    read: u64,
    total: Option<Arc<AtomicU64>>,
}

impl<'a> RangedFile<'a> {
    pub fn new(reader: &'a ResourceReader, lease: ResourceLease) -> Self {
        RangedFile {
            reader,
            lease,
            pos: 0,
            window: Vec::new(),
            window_start: 0,
            read: 0,
            total: None,
        }
    }

    /// Il peso del file all'apertura della lease.
    pub fn len(&self) -> u64 {
        self.lease.stat.size
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// I byte chiesti al kernel finora.
    pub fn bytes_read(&self) -> u64 {
        self.read
    }

    pub fn lease(&self) -> &ResourceLease {
        &self.lease
    }

    /// Un pezzo da `offset`, al più [`CHUNK_BYTES`] e mai oltre la fine.
    fn chunk(&mut self, offset: u64) -> Result<Vec<u8>, KernelError> {
        let left = self.len().saturating_sub(offset);
        let want = usize::try_from(left).map_or(CHUNK_BYTES, |left| left.min(CHUNK_BYTES));
        let bytes = self.reader.read_at(&self.lease, offset, want)?;
        self.read = self.read.saturating_add(bytes.len() as u64);
        if let Some(total) = &self.total {
            total.fetch_add(bytes.len() as u64, Ordering::Relaxed);
        }
        if bytes.is_empty() && want > 0 {
            // La lease dice che i byte ci sono e il disco non li dà: il file
            // è cambiato in un modo che lo stat non ha visto.
            return Err(KernelError::Stale(self.lease.path.clone()));
        }
        Ok(bytes)
    }

    /// Tutti i byte fino a `max`, con la revisione degli stessi pezzi.
    pub fn read_whole(&mut self, max: u64) -> Result<Whole, RangedError> {
        let size = self.check_limit(max)?;
        // Il peso è dello stat del kernel e sta sotto il tetto: non è un
        // numero scritto nel file.
        let mut bytes = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
        let mut hasher = RevisionHasher::new();
        let mut offset = 0;
        while offset < size {
            let piece = self.chunk(offset)?;
            offset += piece.len() as u64;
            hasher.update(&piece);
            bytes.extend_from_slice(&piece);
        }
        let revision = hasher.finish();
        remember(&self.lease, &revision);
        Ok(Whole { bytes, revision })
    }

    /// La revisione dei byte fino a `max`, senza tenerli.
    fn read_revision(&mut self, max: u64) -> Result<Revision, RangedError> {
        let size = self.check_limit(max)?;
        let mut hasher = RevisionHasher::new();
        let mut offset = 0;
        while offset < size {
            let piece = self.chunk(offset)?;
            offset += piece.len() as u64;
            hasher.update(&piece);
        }
        let revision = hasher.finish();
        remember(&self.lease, &revision);
        Ok(revision)
    }

    /// Ricorda `revision` per la lease di questo file: chi l'ha calcolata
    /// sui byte letti da qui la rende a [`Ranged::revision`] e a
    /// [`Ranged::remembered`] finché il file non cambia.
    pub fn remember(&self, revision: &Revision) {
        remember(&self.lease, revision);
    }

    fn check_limit(&self, max: u64) -> Result<u64, RangedError> {
        let size = self.len();
        if size > max {
            return Err(RangedError::OverLimit {
                bytes: size,
                limit: max,
            });
        }
        Ok(size)
    }
}

impl Read for RangedFile<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() || self.pos >= self.len() {
            return Ok(0);
        }
        let end = self.window_start + self.window.len() as u64;
        if self.pos < self.window_start || self.pos >= end {
            self.window = self.chunk(self.pos).map_err(io_of)?;
            self.window_start = self.pos;
        }
        // `pos` sta nella finestra: lo scarto è minore della sua lunghezza.
        let skip = usize::try_from(self.pos - self.window_start).map_err(io::Error::other)?;
        let available = &self.window[skip..];
        let n = available.len().min(buf.len());
        buf[..n].copy_from_slice(&available[..n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for RangedFile<'_> {
    /// Oltre la fine si può andare (la lettura dopo dà zero byte); prima
    /// dell'inizio no.
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let (base, delta) = match pos {
            SeekFrom::Start(at) => {
                self.pos = at;
                return Ok(at);
            }
            SeekFrom::End(delta) => (self.len(), delta),
            SeekFrom::Current(delta) => (self.pos, delta),
        };
        let next = base.checked_add_signed(delta).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "seek prima dell'inizio o oltre u64",
            )
        })?;
        self.pos = next;
        Ok(next)
    }
}

/// Ciò che si ricorda di una revisione: la lease da cui è nata.
struct Remembered {
    identity: Option<FileIdentity>,
    stat: Stat,
    change: Option<u64>,
    revision: Revision,
}

type Memory = HashMap<(Utf8PathBuf, String), Remembered>;

fn memory() -> &'static Mutex<Memory> {
    static MEMORY: OnceLock<Mutex<Memory>> = OnceLock::new();
    MEMORY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// La memoria si legge anche dopo un panico altrove: ogni voce si scrive
/// intera sotto il lucchetto, quindi non ce n'è una a metà.
fn with_memory<R>(f: impl FnOnce(&mut Memory) -> R) -> R {
    let mut guard = memory()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    f(&mut guard)
}

fn remembered(lease: &ResourceLease) -> Option<Revision> {
    with_memory(|memory| {
        let entry = memory.get(&(lease.root.clone(), lease.path.clone()))?;
        (entry.identity.is_some()
            && entry.change.is_some()
            && entry.identity == lease.identity
            && entry.stat == lease.stat
            && entry.change == lease.change)
            .then(|| entry.revision.clone())
    })
}

fn remember(lease: &ResourceLease, revision: &Revision) {
    // Senza identità o timbro la formula non regge: niente da ricordare (e
    // una lease così il kernel non la apre).
    if lease.identity.is_none() || lease.change.is_none() {
        return;
    }
    with_memory(|memory| {
        let key = (lease.root.clone(), lease.path.clone());
        if !memory.contains_key(&key) && memory.len() >= REMEMBERED_REVISIONS {
            memory.clear();
        }
        memory.insert(
            key,
            Remembered {
                identity: lease.identity,
                stat: lease.stat,
                change: lease.change,
                revision: revision.clone(),
            },
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_io_error_is_recognised_and_another_is_not() {
        assert!(is_stale(&io_of(KernelError::Stale("a".into()))));
        assert!(!is_stale(&io_of(KernelError::NotFound("a".into()))));
        assert!(!is_stale(&io::Error::other("stale")));
        assert!(matches!(
            RangedError::from(KernelError::Stale("a".into())),
            RangedError::Stale
        ));
    }
}
