//! La coda di uno ZIP letto a pezzi, guardata prima di darlo a `zip`.
//!
//! [`check`] legge al più gli ultimi [`EOCD_SEARCH`] byte del file (la fine
//! della directory centrale più il commento più lungo) e ogni fine che `zip`
//! potrebbe scegliere: una firma `PK\x05\x06` i cui 22 byte fissi e il cui
//! commento stanno nel file, anche dentro il commento di un'altra. Di ognuna,
//! e della sua fine ZIP64 se la dichiara, guarda le voci, la misura e la
//! posizione della directory: oltre [`MAX_ZIP_ENTRIES`] voci o
//! [`MAX_CENTRAL_DIRECTORY_BYTES`] è [`ContainerError::TooLarge`], una
//! directory che esce dal file o una fine ZIP64 che non c'è è
//! [`ContainerError::NotZip`]. Così un file ostile si ferma prima che `zip`
//! legga un byte della sua directory.
//!
//! `zip` però non legge la directory per la misura dichiarata ma voce per
//! voce, e una voce può dichiarare un nome, un campo extra e un commento di
//! 64 KiB ciascuno: [`Budgeted`] mette un tetto ai byte che `zip` legge,
//! riarmato da chi lo usa prima di aprire l'archivio e prima di ogni voce.

use std::cell::Cell;
use std::io::{self, Read, Seek, SeekFrom};
use std::rc::Rc;

use super::{
    ContainerError, EOCD_LEN, EOCD_SEARCH, EOCD_SIGNATURE, MAX_CENTRAL_DIRECTORY_BYTES,
    MAX_ZIP_ENTRIES, ZIP64_EOCD_SIGNATURE, ZIP64_LOCATOR_LEN, ZIP64_LOCATOR_SIGNATURE,
};

/// La fine della directory ZIP64 senza il settore estensibile.
const ZIP64_EOCD_LEN: u64 = 56;
/// La fine ZIP64 più lunga che si accetta, settore estensibile compreso: `zip`
/// la legge tutta, quindi la distanza dal localizzatore non la decide il file.
const ZIP64_EOCD_MAX: u64 = ZIP64_EOCD_LEN + 64 * 1024;

/// Ciò che la coda dichiara, per chi arma il tetto di [`Budgeted`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Tail {
    /// La directory centrale più grande dichiarata fra le fini possibili.
    pub central_directory: u64,
}

/// La directory di una fine: quante voci, quanto è lunga, dove comincia e il
/// primo byte che non le appartiene più.
struct Directory {
    entries: u64,
    size: u64,
    offset: u64,
    end: u64,
}

/// Guarda la coda di uno ZIP lungo `len` prima di aprirlo.
pub(super) fn check<R: Read + Seek>(reader: &mut R, len: u64) -> Result<Tail, ContainerError> {
    if len < EOCD_LEN as u64 {
        return Err(ContainerError::NotZip);
    }
    let tail_len = len.min(EOCD_SEARCH as u64);
    let from = len - tail_len;
    // Al più 65 557 byte: una costante, non un numero del file.
    let tail = read_at(reader, from, tail_len)?;
    let mut largest: Option<u64> = None;
    for at in 0..=tail.len().saturating_sub(EOCD_LEN) {
        let Some(fixed) = tail.get(at..at + EOCD_LEN) else {
            break;
        };
        if fixed.get(0..4) != Some(&EOCD_SIGNATURE[..]) {
            continue;
        }
        let eocd = from + at as u64;
        let comment = u64::from(le16(fixed, 20)?);
        // Come `zip`: una fine il cui commento esce dal file non si sceglie.
        if eocd + EOCD_LEN as u64 + comment > len {
            continue;
        }
        let Some(directory) = directory_of(reader, fixed, eocd)? else {
            continue;
        };
        if directory.entries > MAX_ZIP_ENTRIES as u64 {
            return Err(ContainerError::TooLarge);
        }
        if directory.size > MAX_CENTRAL_DIRECTORY_BYTES {
            return Err(ContainerError::TooLarge);
        }
        match directory.offset.checked_add(directory.size) {
            Some(end) if end <= directory.end => {}
            _ => return Err(ContainerError::NotZip),
        }
        largest = Some(largest.map_or(directory.size, |seen| seen.max(directory.size)));
    }
    largest
        .map(|central_directory| Tail { central_directory })
        .ok_or(ContainerError::NotZip)
}

/// La directory che la fine `fixed`, in `eocd`, dichiara: la sua, o quella
/// della fine ZIP64 quando un campo vale il massimo e il localizzatore c'è.
/// `None` per una fine ZIP64 che non ha la sua firma: `zip` la scarta e passa
/// alla fine seguente.
fn directory_of<R: Read + Seek>(
    reader: &mut R,
    fixed: &[u8],
    eocd: u64,
) -> Result<Option<Directory>, ContainerError> {
    // `zip` conta le voci di questo disco; il totale si guarda lo stesso.
    let on_disk = u64::from(le16(fixed, 8)?);
    let total = u64::from(le16(fixed, 10)?);
    let size = u64::from(le32(fixed, 12)?);
    let offset = u64::from(le32(fixed, 16)?);
    let classic = Directory {
        entries: on_disk.max(total),
        size,
        offset,
        end: eocd,
    };
    let may_be_zip64 = total == u64::from(u16::MAX)
        || size == u64::from(u32::MAX)
        || offset == u64::from(u32::MAX);
    if !may_be_zip64 {
        return Ok(Some(classic));
    }
    let Some(locator_at) = eocd.checked_sub(ZIP64_LOCATOR_LEN as u64) else {
        return Ok(Some(classic));
    };
    let locator = read_at(reader, locator_at, ZIP64_LOCATOR_LEN as u64)?;
    if locator.get(0..4) != Some(&ZIP64_LOCATOR_SIGNATURE[..]) {
        // Senza localizzatore `zip` legge la fine classica così com'è.
        return Ok(Some(classic));
    }
    let record_at = le64(&locator, 8)?;
    // La fine ZIP64 sta prima del localizzatore, e non lontano.
    let distance = match locator_at.checked_sub(record_at) {
        Some(distance) if distance >= ZIP64_EOCD_LEN => distance,
        _ => return Err(ContainerError::NotZip),
    };
    if distance > ZIP64_EOCD_MAX {
        return Err(ContainerError::TooLarge);
    }
    let record = read_at(reader, record_at, ZIP64_EOCD_LEN)?;
    if record.get(0..4) != Some(&ZIP64_EOCD_SIGNATURE[..]) {
        return Ok(None);
    }
    Ok(Some(Directory {
        entries: le64(&record, 24)?.max(le64(&record, 32)?),
        size: le64(&record, 40)?,
        offset: le64(&record, 48)?,
        end: record_at,
    }))
}

/// `want` byte da `at`, tutti: un file più corto di quanto dice la lease, o
/// che non si legge, non è uno ZIP.
fn read_at<R: Read + Seek>(reader: &mut R, at: u64, want: u64) -> Result<Vec<u8>, ContainerError> {
    reader
        .seek(SeekFrom::Start(at))
        .map_err(|_| ContainerError::NotZip)?;
    let mut out = Vec::new();
    reader
        .take(want)
        .read_to_end(&mut out)
        .map_err(|_| ContainerError::NotZip)?;
    if (out.len() as u64) < want {
        return Err(ContainerError::NotZip);
    }
    Ok(out)
}

fn le16(bytes: &[u8], at: usize) -> Result<u16, ContainerError> {
    bytes
        .get(at..at + 2)
        .and_then(|b| b.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or(ContainerError::NotZip)
}

fn le32(bytes: &[u8], at: usize) -> Result<u32, ContainerError> {
    bytes
        .get(at..at + 4)
        .and_then(|b| b.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or(ContainerError::NotZip)
}

fn le64(bytes: &[u8], at: usize) -> Result<u64, ContainerError> {
    bytes
        .get(at..at + 8)
        .and_then(|b| b.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or(ContainerError::NotZip)
}

/// Quanti byte restano a [`Budgeted`], e se un pezzo è stato rifiutato.
#[derive(Clone, Default)]
pub(super) struct Budget(Rc<BudgetState>);

#[derive(Default)]
struct BudgetState {
    left: Cell<u64>,
    exhausted: Cell<bool>,
}

impl Budget {
    /// Riarma il tetto a `bytes`, e dimentica un rifiuto di prima.
    pub(super) fn arm(&self, bytes: u64) {
        self.0.left.set(bytes);
        self.0.exhausted.set(false);
    }

    /// Un pezzo è stato rifiutato perché il tetto era finito.
    pub(super) fn exhausted(&self) -> bool {
        self.0.exhausted.get()
    }
}

/// Un lettore che non dà più dei byte che il suo [`Budget`] lascia: oltre è
/// un `io::Error`, e il budget lo ricorda.
pub(super) struct Budgeted<R> {
    inner: R,
    budget: Budget,
}

impl<R> Budgeted<R> {
    pub(super) fn new(inner: R, budget: Budget) -> Self {
        Budgeted { inner, budget }
    }
}

impl<R: Read> Read for Budgeted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let left = self.budget.0.left.get();
        if left == 0 {
            self.budget.0.exhausted.set(true);
            return Err(io::Error::other("tetto della lettura a pezzi"));
        }
        let want = usize::try_from(left).map_or(buf.len(), |left| left.min(buf.len()));
        let got = self.inner.read(&mut buf[..want])?;
        self.budget.0.left.set(left - got as u64);
        Ok(got)
    }
}

impl<R: Seek> Seek for Budgeted<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.inner.seek(pos)
    }
}
