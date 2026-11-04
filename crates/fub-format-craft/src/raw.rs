//! L'anteprima JPEG che una foto RAW porta dentro di sé.
//!
//! Quasi ogni RAW porta uno o più JPEG fatti dalla fotocamera. Si trovano
//! leggendo a pezzi soltanto la struttura del file, senza mai decodificare il
//! RAW:
//!
//! - **TIFF** (CR2, NEF, ARW, DNG, e ORF e RW2 con le loro firme `IIRO`,
//!   `MMOR`, `IIU\0`): IFD0, la catena degli IFD dopo e i SubIFD (tag
//!   `0x014A`). Un JPEG viene da `JPEGInterchangeFormat` e `…Length`
//!   (`0x0201`, `0x0202`), o da una striscia sola (`0x0111`, `0x0117`) con
//!   compressione 6 o 7 (`0x0103`); in un RW2 anche dal tag `0x002E`.
//!   L'orientamento è il tag `0x0112` di IFD0.
//! - **CR3** (ISO BMFF, `ftyp` con la marca `crx `): la `uuid` di Canon dentro
//!   `moov`, con `THMB` (la miniatura) e `CMT1` (un IFD0 TIFF, da cui
//!   l'orientamento), e la `uuid` in cima con `PRVW` (il JPEG grande).
//! - **RAF** (`FUJIFILMCCD-RAW `): l'offset e la lunghezza del JPEG agli
//!   offset 84 e 88, big endian; l'orientamento dall'EXIF del JPEG stesso.
//!
//! Ogni misura letta dal file è ostile: offset e lunghezze si controllano
//! contro il file e contro il contenitore che li dichiara, con somme che non
//! traboccano, e ogni cammino ha un tetto con nome ([`MAX_IFDS`],
//! [`MAX_IFD_ENTRIES`], [`MAX_BOX_DEPTH`], [`MAX_BOXES`],
//! [`MAX_CANDIDATES`] offset diversi, ognuno guardato una volta sola), e
//! tutto il cammino legge al più [`MAX_STRUCTURE_BYTES`]. Nessuna allocazione
//! la decide un numero del file oltre un tetto: si alloca al più un IFD di [`MAX_IFD_ENTRIES`] voci, un segmento
//! `APP1` (che non supera 64 KiB) e il JPEG scelto, che non supera
//! [`MAX_JPEG_BYTES`].
//!
//! Un candidato vale solo se comincia con `FF D8`, sta nel suo contenitore,
//! non è vuoto, non supera [`MAX_JPEG_BYTES`] e ha un `SOF` con misure
//! lecite, cercato fra i segmenti come fa [`jpeg::size`](crate::jpeg::size);
//! un `SOF` senza perdita (`C3`, `C7`, `CB`, `CF`) sono i dati del sensore,
//! non un'anteprima che la WebView sa mostrare, e il candidato si scarta. Un
//! candidato che non vale non è un errore: il file può non averne nessuno.

use std::collections::{BTreeSet, VecDeque};
use std::io::{self, Cursor, Read, Seek, SeekFrom};

use crate::container::zip_tail::{Budget, Budgeted};
use crate::container::MAX_PREVIEW_BYTES;
use crate::contract::PreviewSize;
use crate::jpeg::MAX_SEGMENTS;

/// Gli IFD TIFF seguiti al più, IFD0 compreso.
pub const MAX_IFDS: usize = 16;
/// Le voci al più di un IFD.
pub const MAX_IFD_ENTRIES: usize = 1000;
/// I livelli al più di scatole annidate in un CR3; le scatole in cima sono il
/// primo.
pub const MAX_BOX_DEPTH: usize = 8;
/// Le scatole al più che si guardano in un CR3, tutti i livelli insieme.
pub const MAX_BOXES: usize = 10_000;
/// Gli offset diversi dei candidati al più di un file: oltre, il file non
/// dà anteprime anche se nessuno di essi vale.
pub const MAX_CANDIDATES: usize = 64;
/// I byte che si leggono di tutto il file per trovare i candidati: IFD,
/// scatole e intestazioni dei JPEG, fino al loro `SOF`. Oltre è
/// [`RawError::TooLarge`]; i byte del JPEG scelto, letti da [`read_jpeg`],
/// non contano.
pub const MAX_STRUCTURE_BYTES: u64 = 2 * 1024 * 1024;
/// Il JPEG più grande che si prende dal file.
pub const MAX_JPEG_BYTES: u64 = MAX_PREVIEW_BYTES as u64;
/// La larghezza minima di un'anteprima `small`.
pub const SMALL_MIN_WIDTH: u32 = 256;

/// La firma di un RAF di Fujifilm, nei primi 16 byte.
pub const RAF_SIGNATURE: &[u8; 16] = b"FUJIFILMCCD-RAW ";
/// La `uuid` di Canon dentro `moov` di un CR3, con `CMT1` e `THMB`.
pub const CR3_CANON_UUID: [u8; 16] = [
    0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48,
];
/// La `uuid` in cima a un CR3 con `PRVW`, dopo 8 byte suoi.
pub const CR3_PREVIEW_UUID: [u8; 16] = [
    0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88, 0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16,
];
/// La marca di `ftyp` di un CR3.
pub const CR3_BRAND: &[u8; 4] = b"crx ";
/// Dove comincia il JPEG di `THMB` e di `PRVW`, dall'inizio della scatola; la
/// sua lunghezza sta 8 byte prima.
pub const CR3_JPEG_AT: u64 = 24;
/// Dove stanno offset e lunghezza del JPEG in un RAF.
pub const RAF_POINTER_AT: u64 = 84;

/// Le firme TIFF dopo `II` o `MM`: 42, ORF (`RO`), RW2 (`U\0`).
const TIFF_MAGIC: u16 = 42;
const ORF_MAGIC: u16 = 0x4F52;
const RW2_MAGIC: u16 = 0x0055;

const TAG_COMPRESSION: u16 = 0x0103;
const TAG_STRIP_OFFSETS: u16 = 0x0111;
const TAG_ORIENTATION: u16 = 0x0112;
const TAG_STRIP_BYTE_COUNTS: u16 = 0x0117;
const TAG_SUB_IFDS: u16 = 0x014A;
const TAG_JPEG_OFFSET: u16 = 0x0201;
const TAG_JPEG_LENGTH: u16 = 0x0202;
const TAG_RW2_JPEG: u16 = 0x002E;

const TYPE_SHORT: u16 = 3;
const TYPE_LONG: u16 = 4;
const TYPE_UNDEFINED: u16 = 7;
const TYPE_IFD: u16 = 13;

/// Un JPEG nel file: dove comincia, quanto è lungo e le misure del suo `SOF`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JpegRange {
    pub offset: u64,
    pub len: u64,
    pub width: u32,
    pub height: u32,
}

impl JpegRange {
    fn area(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }
}

/// I JPEG di un RAW e l'orientamento da applicare a quello scelto.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawPreviews {
    /// I candidati validi, senza doppioni, nell'ordine in cui il file li
    /// dichiara.
    pub candidates: Vec<JpegRange>,
    /// L'orientamento EXIF da 1 a 8; 1 quando il file non lo dice o dice un
    /// valore fuori da 1–8.
    pub orientation: u8,
}

impl RawPreviews {
    /// Il candidato per la misura `size`: per `large` il più grande; per
    /// `small` il più piccolo largo almeno [`SMALL_MIN_WIDTH`], o il più
    /// grande se nessuno lo è. «Grande» si misura in pixel, a parità in byte.
    pub fn pick(&self, size: PreviewSize) -> Option<JpegRange> {
        let largest = self
            .candidates
            .iter()
            .max_by_key(|range| (range.area(), range.len))
            .copied();
        match size {
            PreviewSize::Large => largest,
            PreviewSize::Small => self
                .candidates
                .iter()
                .filter(|range| range.width >= SMALL_MIN_WIDTH)
                .min_by_key(|range| (range.area(), range.len))
                .copied()
                .or(largest),
        }
    }
}

/// Perché un RAW non dà i suoi JPEG. Senza testi.
#[derive(Debug)]
pub enum RawError {
    /// Non ha la firma di nessuna delle forme note (un `.CR3` che è un MP4
    /// qualunque, un file vuoto).
    NotRaw,
    /// Una misura esce dal file o dal suo contenitore, un IFD è già stato
    /// visitato, una scatola ha misura 0 o più piccola della sua intestazione.
    Malformed,
    /// Un cammino supera il suo tetto.
    TooLarge,
    /// La lettura non è riuscita: chi legge a pezzi riconosce qui un file
    /// cambiato.
    Io(io::Error),
}

impl From<io::Error> for RawError {
    fn from(error: io::Error) -> Self {
        RawError::Io(error)
    }
}

/// I JPEG che il RAW lungo `len` byte porta dentro, letti da `reader` a
/// pezzi: l'intestazione, gli IFD o le scatole, e l'intestazione di ogni
/// candidato fino al suo `SOF`.
pub fn embedded_jpegs<R: Read + Seek>(reader: &mut R, len: u64) -> Result<RawPreviews, RawError> {
    let budget = Budget::default();
    budget.arm(MAX_STRUCTURE_BYTES);
    let mut budgeted = Budgeted::new(&mut *reader, budget.clone());
    match previews_of(&mut budgeted, len) {
        // Ogni errore dopo il tetto è il tetto: il file chiede troppo lavoro.
        Err(_) if budget.exhausted() => Err(RawError::TooLarge),
        outcome => outcome,
    }
}

fn previews_of<R: Read + Seek>(reader: &mut R, len: u64) -> Result<RawPreviews, RawError> {
    let mut head = [0u8; 16];
    let have = usize::try_from(len.min(16)).unwrap_or(16);
    read_at(reader, 0, &mut head[..have])?;
    let head = &head[..have];
    let (spans, orientation) = if head.starts_with(RAF_SIGNATURE) {
        raf(reader, len)?
    } else if head.get(4..8) == Some(&b"ftyp"[..]) {
        cr3(reader, len)?
    } else if head.starts_with(b"II") || head.starts_with(b"MM") {
        let tiff = Tiff::header(reader, 0, len)?;
        tiff.walk(reader)?
    } else {
        return Err(RawError::NotRaw);
    };
    // Un offset si guarda una volta sola, il primo che lo dichiara vince; e
    // oltre [`MAX_CANDIDATES`] offset diversi non se ne guarda nessuno.
    let mut offsets = BTreeSet::new();
    let spans: Vec<Span> = spans
        .into_iter()
        .filter(|span| offsets.insert(span.offset))
        .collect();
    if spans.len() > MAX_CANDIDATES {
        return Err(RawError::TooLarge);
    }
    let mut candidates: Vec<JpegRange> = Vec::new();
    for span in spans {
        if let Some(range) = check_jpeg(reader, span)? {
            candidates.push(range);
        }
    }
    let orientation = match orientation {
        Orientation::Known(value) => value,
        Orientation::FromJpeg => match candidates.first() {
            Some(range) => jpeg_orientation(reader, range)?.unwrap_or(1),
            None => 1,
        },
    };
    Ok(RawPreviews {
        candidates,
        orientation,
    })
}

/// I byte del JPEG `range`, che [`embedded_jpegs`] ha già misurato: al più
/// [`MAX_JPEG_BYTES`].
pub fn read_jpeg<R: Read + Seek>(reader: &mut R, range: &JpegRange) -> Result<Vec<u8>, RawError> {
    if range.len > MAX_JPEG_BYTES {
        return Err(RawError::TooLarge);
    }
    let len = usize::try_from(range.len).map_err(|_| RawError::TooLarge)?;
    let mut bytes = vec![0u8; len];
    read_at(reader, range.offset, &mut bytes)?;
    Ok(bytes)
}

/// Un JPEG dichiarato dal file, non ancora controllato: dove comincia, quanto
/// è lungo e dove finisce il contenitore che lo dichiara.
#[derive(Clone, Copy, Debug)]
struct Span {
    offset: u64,
    len: u64,
    end: u64,
}

/// Da dove viene l'orientamento.
enum Orientation {
    Known(u8),
    /// Dall'EXIF del JPEG (un RAF).
    FromJpeg,
}

fn read_at<R: Read + Seek>(reader: &mut R, offset: u64, buf: &mut [u8]) -> io::Result<()> {
    reader.seek(SeekFrom::Start(offset))?;
    reader.read_exact(buf)
}

/// La fine di `len` byte da `offset`, se stanno prima di `end`.
fn fits(offset: u64, len: u64, end: u64) -> Option<u64> {
    offset.checked_add(len).filter(|stop| *stop <= end)
}

/// L'orientamento lecito, o 1.
fn lawful_orientation(value: u32) -> u8 {
    u8::try_from(value)
        .ok()
        .filter(|value| (1..=8).contains(value))
        .unwrap_or(1)
}

// --- TIFF -------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Order {
    Little,
    Big,
}

impl Order {
    fn u16(self, bytes: [u8; 2]) -> u16 {
        match self {
            Order::Little => u16::from_le_bytes(bytes),
            Order::Big => u16::from_be_bytes(bytes),
        }
    }

    fn u32(self, bytes: [u8; 4]) -> u32 {
        match self {
            Order::Little => u32::from_le_bytes(bytes),
            Order::Big => u32::from_be_bytes(bytes),
        }
    }
}

/// Una voce di un IFD: il valore sono i 4 byte del campo, da leggere col tipo.
struct Entry {
    tag: u16,
    kind: u16,
    count: u32,
    value: [u8; 4],
}

impl Entry {
    /// Il numero di una voce con un valore solo, `SHORT`, `LONG` o `IFD`.
    fn number(&self, order: Order) -> Option<u32> {
        if self.count != 1 {
            return None;
        }
        match self.kind {
            TYPE_SHORT => Some(u32::from(order.u16([self.value[0], self.value[1]]))),
            TYPE_LONG | TYPE_IFD => Some(order.u32(self.value)),
            _ => None,
        }
    }
}

/// Un TIFF che comincia a `base` e finisce a `end`: i suoi offset contano da
/// `base`.
struct Tiff {
    order: Order,
    magic: u16,
    base: u64,
    end: u64,
    ifd0: u64,
}

impl Tiff {
    fn header<R: Read + Seek>(reader: &mut R, base: u64, end: u64) -> Result<Tiff, RawError> {
        if fits(base, 8, end).is_none() {
            return Err(RawError::NotRaw);
        }
        let mut head = [0u8; 8];
        read_at(reader, base, &mut head)?;
        let order = match &head[..2] {
            b"II" => Order::Little,
            b"MM" => Order::Big,
            _ => return Err(RawError::NotRaw),
        };
        let magic = order.u16([head[2], head[3]]);
        if !matches!(magic, TIFF_MAGIC | ORF_MAGIC | RW2_MAGIC) {
            return Err(RawError::NotRaw);
        }
        let ifd0 = u64::from(order.u32([head[4], head[5], head[6], head[7]]));
        if ifd0 == 0 {
            return Err(RawError::Malformed);
        }
        Ok(Tiff {
            order,
            magic,
            base,
            end,
            ifd0,
        })
    }

    /// L'offset assoluto di un offset del TIFF.
    fn absolute(&self, offset: u64) -> Result<u64, RawError> {
        self.base.checked_add(offset).ok_or(RawError::Malformed)
    }

    /// Le voci dell'IFD all'offset `offset` e l'offset del prossimo.
    fn ifd<R: Read + Seek>(
        &self,
        reader: &mut R,
        offset: u64,
    ) -> Result<(Vec<Entry>, u64), RawError> {
        let at = self.absolute(offset)?;
        let after_count = fits(at, 2, self.end).ok_or(RawError::Malformed)?;
        let mut count = [0u8; 2];
        read_at(reader, at, &mut count)?;
        let count = usize::from(self.order.u16(count));
        if count > MAX_IFD_ENTRIES {
            return Err(RawError::TooLarge);
        }
        // Le voci e i 4 byte del prossimo IFD: al più 12 004 byte.
        let block = count * 12 + 4;
        fits(after_count, block as u64, self.end).ok_or(RawError::Malformed)?;
        let mut bytes = vec![0u8; block];
        read_at(reader, after_count, &mut bytes)?;
        let (fields, next) = bytes.split_at(count * 12);
        let entries = fields
            .chunks_exact(12)
            .map(|raw| Entry {
                tag: self.order.u16([raw[0], raw[1]]),
                kind: self.order.u16([raw[2], raw[3]]),
                count: self.order.u32([raw[4], raw[5], raw[6], raw[7]]),
                value: [raw[8], raw[9], raw[10], raw[11]],
            })
            .collect();
        let next = u64::from(self.order.u32([next[0], next[1], next[2], next[3]]));
        Ok((entries, next))
    }

    /// Gli offset dei SubIFD di una voce `0x014A`: al più [`MAX_IFDS`].
    fn sub_ifds<R: Read + Seek>(
        &self,
        reader: &mut R,
        entry: &Entry,
    ) -> Result<Vec<u64>, RawError> {
        if !matches!(entry.kind, TYPE_LONG | TYPE_IFD) {
            return Ok(Vec::new());
        }
        let count = usize::try_from(entry.count).map_err(|_| RawError::TooLarge)?;
        if count > MAX_IFDS {
            return Err(RawError::TooLarge);
        }
        if count <= 1 {
            return Ok(entry
                .number(self.order)
                .map(u64::from)
                .into_iter()
                .collect());
        }
        let at = self.absolute(u64::from(self.order.u32(entry.value)))?;
        fits(at, (count * 4) as u64, self.end).ok_or(RawError::Malformed)?;
        let mut bytes = vec![0u8; count * 4];
        read_at(reader, at, &mut bytes)?;
        Ok(bytes
            .chunks_exact(4)
            .map(|raw| u64::from(self.order.u32([raw[0], raw[1], raw[2], raw[3]])))
            .collect())
    }

    /// Un JPEG dichiarato dal TIFF, col suo offset relativo.
    fn span(&self, offset: u32, len: u32) -> Option<Span> {
        Some(Span {
            offset: self.base.checked_add(u64::from(offset))?,
            len: u64::from(len),
            end: self.end,
        })
    }

    /// IFD0, la catena dopo e i SubIFD: al più [`MAX_IFDS`], nessuno due
    /// volte.
    fn walk<R: Read + Seek>(&self, reader: &mut R) -> Result<(Vec<Span>, Orientation), RawError> {
        let mut queue = VecDeque::from([self.ifd0]);
        let mut visited = BTreeSet::new();
        let mut spans = Vec::new();
        let mut orientation = 1;
        while let Some(offset) = queue.pop_front() {
            if !visited.insert(offset) {
                return Err(RawError::Malformed);
            }
            if visited.len() > MAX_IFDS {
                return Err(RawError::TooLarge);
            }
            let (entries, next) = self.ifd(reader, offset)?;
            let mut jpeg = (None, None);
            let mut strip = (None, None);
            let mut compression = None;
            for entry in &entries {
                let number = entry.number(self.order);
                match entry.tag {
                    TAG_ORIENTATION if offset == self.ifd0 => {
                        orientation = number.map_or(1, lawful_orientation);
                    }
                    TAG_JPEG_OFFSET => jpeg.0 = number,
                    TAG_JPEG_LENGTH => jpeg.1 = number,
                    TAG_STRIP_OFFSETS => strip.0 = number,
                    TAG_STRIP_BYTE_COUNTS => strip.1 = number,
                    TAG_COMPRESSION => compression = number,
                    TAG_SUB_IFDS => {
                        queue.extend(
                            self.sub_ifds(reader, entry)?
                                .into_iter()
                                .filter(|sub| *sub != 0),
                        );
                    }
                    TAG_RW2_JPEG if self.magic == RW2_MAGIC && entry.kind == TYPE_UNDEFINED => {
                        spans.extend(self.span(self.order.u32(entry.value), entry.count));
                    }
                    _ => {}
                }
            }
            if let (Some(at), Some(len)) = jpeg {
                spans.extend(self.span(at, len));
            }
            if let (Some(at), Some(len), Some(6 | 7)) = (strip.0, strip.1, compression) {
                spans.extend(self.span(at, len));
            }
            if next != 0 {
                queue.push_back(next);
            }
        }
        Ok((spans, Orientation::Known(orientation)))
    }
}

/// L'orientamento di IFD0 del TIFF fra `base` e `end`: 1 se non lo dice o se
/// il TIFF non si legge; solo un errore di lettura passa.
fn ifd0_orientation<R: Read + Seek>(reader: &mut R, base: u64, end: u64) -> Result<u8, RawError> {
    let found = Tiff::header(reader, base, end).and_then(|tiff| {
        let (entries, _) = tiff.ifd(reader, tiff.ifd0)?;
        Ok(entries
            .iter()
            .find(|entry| entry.tag == TAG_ORIENTATION)
            .and_then(|entry| entry.number(tiff.order))
            .map_or(1, lawful_orientation))
    });
    match found {
        Ok(value) => Ok(value),
        Err(RawError::Io(error)) => Err(RawError::Io(error)),
        Err(_) => Ok(1),
    }
}

// --- CR3 --------------------------------------------------------------------

/// Una scatola ISO BMFF: il tipo, dove comincia, dove cominciano i suoi dati e
/// dove finisce.
struct Bmff {
    kind: [u8; 4],
    uuid: Option<[u8; 16]>,
    start: u64,
    payload: u64,
    end: u64,
}

/// La scatola a `at`, che deve stare intera prima di `end`.
fn bmff<R: Read + Seek>(reader: &mut R, at: u64, end: u64) -> Result<Bmff, RawError> {
    fits(at, 8, end).ok_or(RawError::Malformed)?;
    let mut head = [0u8; 8];
    read_at(reader, at, &mut head)?;
    let mut size = u64::from(u32::from_be_bytes([head[0], head[1], head[2], head[3]]));
    let kind = [head[4], head[5], head[6], head[7]];
    let mut header = 8u64;
    if size == 1 {
        fits(at, 16, end).ok_or(RawError::Malformed)?;
        let mut large = [0u8; 8];
        reader.read_exact(&mut large)?;
        size = u64::from_be_bytes(large);
        header = 16;
    }
    // Una misura 0 vorrebbe dire «fino alla fine del file»: in un CR3 non
    // capita, e qui è una scatola rotta come una più corta della sua
    // intestazione.
    if size < header {
        return Err(RawError::Malformed);
    }
    let stop = fits(at, size, end).ok_or(RawError::Malformed)?;
    let mut uuid = None;
    if &kind == b"uuid" {
        if header + 16 > size {
            return Err(RawError::Malformed);
        }
        let mut id = [0u8; 16];
        read_at(reader, at + header, &mut id)?;
        uuid = Some(id);
        header += 16;
    }
    Ok(Bmff {
        kind,
        uuid,
        start: at,
        payload: at + header,
        end: stop,
    })
}

/// Le scatole di un CR3: `ftyp` con la marca `crx ` per prima, poi `moov`,
/// le due `uuid` di Canon, `THMB`, `PRVW` e `CMT1`.
fn cr3<R: Read + Seek>(reader: &mut R, len: u64) -> Result<(Vec<Span>, Orientation), RawError> {
    let ftyp = bmff(reader, 0, len)?;
    if &ftyp.kind != b"ftyp" || fits(ftyp.payload, 4, ftyp.end).is_none() {
        return Err(RawError::NotRaw);
    }
    let mut brand = [0u8; 4];
    read_at(reader, ftyp.payload, &mut brand)?;
    if &brand != CR3_BRAND {
        return Err(RawError::NotRaw);
    }
    let mut spans = Vec::new();
    let mut orientation = None;
    let mut boxes = 1usize;
    // Per ogni contenitore aperto: dove comincia la prossima scatola, dove
    // finisce il contenitore, a che livello stanno le sue scatole.
    let mut stack = vec![(ftyp.end, len, 1usize)];
    while let Some(top) = stack.last_mut() {
        let (at, end, depth) = *top;
        // Meno di un'intestazione in fondo al contenitore: è finito.
        if fits(at, 8, end).is_none() {
            stack.pop();
            continue;
        }
        boxes += 1;
        if boxes > MAX_BOXES || depth > MAX_BOX_DEPTH {
            return Err(RawError::TooLarge);
        }
        let node = bmff(reader, at, end)?;
        top.0 = node.end;
        let children = match (&node.kind, node.uuid) {
            (b"moov", _) | (b"uuid", Some(CR3_CANON_UUID)) => Some(node.payload),
            (b"uuid", Some(CR3_PREVIEW_UUID)) => {
                Some(node.payload.checked_add(8).ok_or(RawError::Malformed)?)
            }
            (b"THMB" | b"PRVW", _) => {
                spans.extend(cr3_jpeg(reader, &node)?);
                None
            }
            (b"CMT1", _) => {
                if orientation.is_none() {
                    orientation = Some(ifd0_orientation(reader, node.payload, node.end)?);
                }
                None
            }
            _ => None,
        };
        if let Some(first) = children {
            // Un contenitore vuoto all'ultimo livello va bene: il tetto
            // scatta sulla prima scatola che sta oltre.
            if first > node.end {
                return Err(RawError::Malformed);
            }
            stack.push((first, node.end, depth + 1));
        }
    }
    Ok((spans, Orientation::Known(orientation.unwrap_or(1))))
}

/// Il JPEG di `THMB` o `PRVW`: la lunghezza a 16 byte dall'inizio della
/// scatola, i byte da [`CR3_JPEG_AT`], dentro la scatola.
fn cr3_jpeg<R: Read + Seek>(reader: &mut R, node: &Bmff) -> Result<Option<Span>, RawError> {
    let Some(data) = fits(node.start, CR3_JPEG_AT, node.end) else {
        return Ok(None);
    };
    let mut len = [0u8; 4];
    read_at(reader, data - 8, &mut len)?;
    Ok(Some(Span {
        offset: data,
        len: u64::from(u32::from_be_bytes(len)),
        end: node.end,
    }))
}

// --- RAF --------------------------------------------------------------------

/// Il JPEG di un RAF: offset e lunghezza big endian a [`RAF_POINTER_AT`].
fn raf<R: Read + Seek>(reader: &mut R, len: u64) -> Result<(Vec<Span>, Orientation), RawError> {
    fits(RAF_POINTER_AT, 8, len).ok_or(RawError::Malformed)?;
    let mut pointer = [0u8; 8];
    read_at(reader, RAF_POINTER_AT, &mut pointer)?;
    let offset = u32::from_be_bytes([pointer[0], pointer[1], pointer[2], pointer[3]]);
    let jpeg_len = u32::from_be_bytes([pointer[4], pointer[5], pointer[6], pointer[7]]);
    Ok((
        vec![Span {
            offset: u64::from(offset),
            len: u64::from(jpeg_len),
            end: len,
        }],
        Orientation::FromJpeg,
    ))
}

// --- JPEG -------------------------------------------------------------------

/// Un marcatore di inizio fotogramma (`C0`–`CF` tranne `C4`, `C8`, `CC`),
/// come in [`jpeg::size`](crate::jpeg::size).
fn is_sof(marker: u8) -> bool {
    matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC)
}

/// Un `SOF` senza perdita: i dati del sensore, non un'immagine da mostrare.
fn is_lossless(marker: u8) -> bool {
    matches!(marker, 0xC3 | 0xC7 | 0xCB | 0xCF)
}

/// Che cosa cerca il cammino fra i segmenti di un JPEG.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Goal {
    /// Le misure dal `SOF`.
    Size,
    /// L'orientamento dall'`APP1` EXIF, prima del `SOF`.
    Exif,
}

/// Ciò che il cammino ha trovato.
enum Found {
    Size(u32, u32),
    Exif(u8),
}

/// I segmenti di un JPEG fra `start` e `stop`, uno dopo l'altro, come
/// [`jpeg::size`](crate::jpeg::size): al più [`MAX_SEGMENTS`], ogni
/// lunghezza dentro i byte del candidato. `None` quando il JPEG non ha ciò
/// che si cerca o non è un JPEG.
fn walk_jpeg<R: Read + Seek>(
    reader: &mut R,
    start: u64,
    stop: u64,
    goal: Goal,
) -> Result<Option<Found>, RawError> {
    if fits(start, 2, stop).is_none() {
        return Ok(None);
    }
    let mut soi = [0u8; 2];
    read_at(reader, start, &mut soi)?;
    if soi != [0xFF, 0xD8] {
        return Ok(None);
    }
    let mut at = start + 2;
    let mut byte = [0u8; 1];
    for _ in 0..MAX_SEGMENTS {
        // Un marcatore è `FF` seguito da un byte che non è `FF`: i `FF` in più
        // sono riempimento.
        if at >= stop {
            return Ok(None);
        }
        read_at(reader, at, &mut byte)?;
        if byte[0] != 0xFF {
            return Ok(None);
        }
        let marker = loop {
            at += 1;
            if at >= stop {
                return Ok(None);
            }
            reader.read_exact(&mut byte)?;
            if byte[0] != 0xFF {
                break byte[0];
            }
        };
        at += 1;
        match marker {
            // I marcatori senza lunghezza: `TEM` e `RST0`–`RST7`.
            0x01 | 0xD0..=0xD7 => continue,
            // `SOI` di nuovo, `EOI`, i dati della scansione: niente da trovare.
            0x00 | 0xD8 | 0xD9 | 0xDA => return Ok(None),
            _ => {}
        }
        if fits(at, 2, stop).is_none() {
            return Ok(None);
        }
        let mut length = [0u8; 2];
        reader.read_exact(&mut length)?;
        let length = u16::from_be_bytes(length);
        if length < 2 {
            return Ok(None);
        }
        let Some(next) = fits(at, u64::from(length), stop) else {
            return Ok(None);
        };
        let payload = at + 2;
        if is_sof(marker) {
            if goal == Goal::Exif || is_lossless(marker) || length < 7 {
                return Ok(None);
            }
            let mut sof = [0u8; 5];
            read_at(reader, payload, &mut sof)?;
            let height = u32::from(u16::from_be_bytes([sof[1], sof[2]]));
            let width = u32::from(u16::from_be_bytes([sof[3], sof[4]]));
            // Un `u16` non supera 65 535: basta che non sia zero.
            return Ok((width != 0 && height != 0).then_some(Found::Size(width, height)));
        }
        if goal == Goal::Exif && marker == 0xE1 {
            // Al più 65 533 byte: la lunghezza è un `u16`.
            let mut app1 = vec![0u8; usize::from(length - 2)];
            read_at(reader, payload, &mut app1)?;
            if let Some(tiff) = app1.strip_prefix(&b"Exif\0\0"[..]) {
                let end = tiff.len() as u64;
                let value = ifd0_orientation(&mut Cursor::new(tiff), 0, end)?;
                return Ok(Some(Found::Exif(value)));
            }
        }
        at = next;
    }
    Ok(None)
}

/// Il candidato `span`, se è un JPEG che si può mostrare: dentro il suo
/// contenitore, non vuoto, al più [`MAX_JPEG_BYTES`], con le misure del suo
/// `SOF`.
fn check_jpeg<R: Read + Seek>(reader: &mut R, span: Span) -> Result<Option<JpegRange>, RawError> {
    if span.len == 0 || span.len > MAX_JPEG_BYTES {
        return Ok(None);
    }
    let Some(stop) = fits(span.offset, span.len, span.end) else {
        return Ok(None);
    };
    match walk_jpeg(reader, span.offset, stop, Goal::Size)? {
        Some(Found::Size(width, height)) => Ok(Some(JpegRange {
            offset: span.offset,
            len: span.len,
            width,
            height,
        })),
        _ => Ok(None),
    }
}

/// L'orientamento scritto nell'EXIF del JPEG `range`, se c'è.
fn jpeg_orientation<R: Read + Seek>(
    reader: &mut R,
    range: &JpegRange,
) -> Result<Option<u8>, RawError> {
    let stop = range.offset.saturating_add(range.len);
    match walk_jpeg(reader, range.offset, stop, Goal::Exif)? {
        Some(Found::Exif(value)) => Ok(Some(value)),
        _ => Ok(None),
    }
}
