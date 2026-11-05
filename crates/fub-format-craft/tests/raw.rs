//! I JPEG dentro le foto RAW, contro file costruiti dal test: TIFF `II` e
//! `MM` con IFD0 e IFD1, un DNG con i SubIFD, ORF e RW2 con le loro firme, un
//! CR3 con le scatole minime, un RAF con l'intestazione; i file cattivi (un
//! anello di IFD, troppe voci, offset oltre la fine, scatole rotte o troppo
//! annidate, JPEG troppo grandi o senza `SOF`); e un RAW sparso di 50 MiB
//! letto da un lettore che conta i byte, senza 50 MiB veri.

use std::io::{self, Cursor, Read, Seek, SeekFrom};

use fub_format_craft::raw::{
    embedded_jpegs, read_jpeg, JpegRange, RawError, RawPreviews, CR3_CANON_UUID, CR3_PREVIEW_UUID,
    MAX_BOXES, MAX_BOX_DEPTH, MAX_CANDIDATES, MAX_IFDS, MAX_IFD_ENTRIES, MAX_JPEG_BYTES,
    MAX_STRUCTURE_BYTES, RAF_SIGNATURE, SMALL_MIN_WIDTH,
};
use fub_format_craft::PreviewSize;

// --- JPEG -------------------------------------------------------------------

fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0xFF, marker];
    out.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn sof(marker: u8, width: u16, height: u16) -> Vec<u8> {
    let mut payload = vec![8];
    payload.extend_from_slice(&height.to_be_bytes());
    payload.extend_from_slice(&width.to_be_bytes());
    payload.extend_from_slice(&[1, 1, 0x11, 0]);
    segment(marker, &payload)
}

/// `SOI`, i segmenti, una scansione finta, `pad` byte di dati, `EOI`.
fn jpeg_with(segments: &[Vec<u8>], pad: usize) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8];
    for part in segments {
        out.extend_from_slice(part);
    }
    out.extend_from_slice(&segment(0xDA, &[1, 1, 0, 0, 63, 0]));
    out.extend(std::iter::repeat_n(0x55, pad));
    out.extend_from_slice(&[0xFF, 0xD9]);
    out
}

/// Un JPEG base minimo di `width`×`height`, con una tabella prima del `SOF`.
fn jpeg(width: u16, height: u16) -> Vec<u8> {
    jpeg_with(&[segment(0xDB, &[0; 65]), sof(0xC0, width, height)], 16)
}

/// Un JPEG con un `APP1` EXIF che dice l'orientamento `value`.
fn jpeg_with_exif(width: u16, height: u16, value: u16) -> Vec<u8> {
    let mut exif = b"Exif\0\0".to_vec();
    exif.extend_from_slice(b"MM\0\x2a\0\0\0\x08");
    exif.extend_from_slice(&1u16.to_be_bytes());
    exif.extend_from_slice(&0x0112u16.to_be_bytes());
    exif.extend_from_slice(&3u16.to_be_bytes());
    exif.extend_from_slice(&1u32.to_be_bytes());
    exif.extend_from_slice(&value.to_be_bytes());
    exif.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    jpeg_with(&[segment(0xE1, &exif), sof(0xC0, width, height)], 16)
}

// --- TIFF -------------------------------------------------------------------

const SHORT: u16 = 3;
const LONG: u16 = 4;
const UNDEFINED: u16 = 7;

#[derive(Clone, Copy, Debug)]
enum Endian {
    Ii,
    Mm,
}

impl Endian {
    fn u16(self, value: u16) -> [u8; 2] {
        match self {
            Endian::Ii => value.to_le_bytes(),
            Endian::Mm => value.to_be_bytes(),
        }
    }

    fn u32(self, value: u32) -> [u8; 4] {
        match self {
            Endian::Ii => value.to_le_bytes(),
            Endian::Mm => value.to_be_bytes(),
        }
    }
}

fn put(buf: &mut Vec<u8>, at: usize, bytes: &[u8]) {
    if buf.len() < at + bytes.len() {
        buf.resize(at + bytes.len(), 0);
    }
    buf[at..at + bytes.len()].copy_from_slice(bytes);
}

/// Un TIFF costruito a mano: l'intestazione, gli IFD e i byte dove si vuole.
struct Tiff {
    endian: Endian,
    buf: Vec<u8>,
}

/// Una voce: tag, tipo, conto, valore.
type Field = (u16, u16, u32, u32);

impl Tiff {
    fn new(endian: Endian, magic: u16, ifd0: u32) -> Tiff {
        let mut buf = match endian {
            Endian::Ii => b"II".to_vec(),
            Endian::Mm => b"MM".to_vec(),
        };
        buf.extend_from_slice(&endian.u16(magic));
        buf.extend_from_slice(&endian.u32(ifd0));
        Tiff { endian, buf }
    }

    fn ifd(&mut self, at: u32, fields: &[Field], next: u32) -> &mut Self {
        let e = self.endian;
        let mut out = e.u16(u16::try_from(fields.len()).unwrap()).to_vec();
        for &(tag, kind, count, value) in fields {
            out.extend_from_slice(&e.u16(tag));
            out.extend_from_slice(&e.u16(kind));
            out.extend_from_slice(&e.u32(count));
            if kind == SHORT && count == 1 {
                out.extend_from_slice(&e.u16(u16::try_from(value).unwrap()));
                out.extend_from_slice(&[0, 0]);
            } else {
                out.extend_from_slice(&e.u32(value));
            }
        }
        out.extend_from_slice(&e.u32(next));
        put(&mut self.buf, at as usize, &out);
        self
    }

    fn bytes(&mut self, at: u32, bytes: &[u8]) -> &mut Self {
        put(&mut self.buf, at as usize, bytes);
        self
    }

    fn build(&self) -> Vec<u8> {
        self.buf.clone()
    }
}

/// Le voci di un JPEG da `JPEGInterchangeFormat`.
fn jif(at: u32, bytes: &[u8]) -> [Field; 2] {
    [(0x0201, LONG, 1, at), (0x0202, LONG, 1, bytes.len() as u32)]
}

fn previews(bytes: &[u8]) -> Result<RawPreviews, RawError> {
    embedded_jpegs(&mut Cursor::new(bytes), bytes.len() as u64)
}

fn sizes(previews: &RawPreviews) -> Vec<(u32, u32)> {
    previews
        .candidates
        .iter()
        .map(|range| (range.width, range.height))
        .collect()
}

/// Un TIFF con IFD0 (orientamento 6, il JPEG grande) e IFD1 (la miniatura).
fn two_ifds(endian: Endian) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let big = jpeg(1620, 1080);
    let small = jpeg(160, 120);
    let [a, b] = jif(1000, &big);
    let [c, d] = jif(3000, &small);
    let bytes = Tiff::new(endian, 42, 8)
        .ifd(8, &[(0x0112, SHORT, 1, 6), a, b], 200)
        .ifd(200, &[c, d], 0)
        .bytes(1000, &big)
        .bytes(3000, &small)
        .build();
    (bytes, big, small)
}

#[test]
fn a_tiff_ii_and_mm_gives_the_jpegs_of_ifd0_and_ifd1() {
    for endian in [Endian::Ii, Endian::Mm] {
        let (bytes, big, small) = two_ifds(endian);
        let found = previews(&bytes).unwrap();
        assert_eq!(found.orientation, 6, "{endian:?}");
        assert_eq!(sizes(&found), vec![(1620, 1080), (160, 120)], "{endian:?}");
        let large = found.pick(PreviewSize::Large).unwrap();
        assert_eq!(
            read_jpeg(&mut Cursor::new(&bytes), &large).unwrap(),
            big,
            "{endian:?}"
        );
        // Nessuno è stretto meno di 256 tranne la miniatura: `small` prende
        // il più piccolo largo abbastanza.
        assert_eq!(found.pick(PreviewSize::Small), Some(large));
        let thumb = found.candidates[1];
        assert_eq!(read_jpeg(&mut Cursor::new(&bytes), &thumb).unwrap(), small);
    }
}

#[test]
fn small_takes_the_smallest_wide_enough_and_large_the_largest() {
    let range = |width: u32, len: u64| JpegRange {
        offset: 0,
        len,
        width,
        height: width / 2,
    };
    let found = RawPreviews {
        candidates: vec![range(160, 10), range(1620, 30), range(512, 20)],
        orientation: 1,
    };
    assert_eq!(found.pick(PreviewSize::Small).unwrap().width, 512);
    assert_eq!(found.pick(PreviewSize::Large).unwrap().width, 1620);
    // Al confine: 256 basta.
    let found = RawPreviews {
        candidates: vec![range(SMALL_MIN_WIDTH, 10), range(1620, 30)],
        orientation: 1,
    };
    assert_eq!(
        found.pick(PreviewSize::Small).unwrap().width,
        SMALL_MIN_WIDTH
    );
    // Nessuno largo abbastanza: il più grande.
    let found = RawPreviews {
        candidates: vec![range(160, 10), range(200, 20)],
        orientation: 1,
    };
    assert_eq!(found.pick(PreviewSize::Small).unwrap().width, 200);
    let none = RawPreviews {
        candidates: Vec::new(),
        orientation: 1,
    };
    assert_eq!(none.pick(PreviewSize::Small), None);
    assert_eq!(none.pick(PreviewSize::Large), None);
}

#[test]
fn a_dng_takes_the_preview_of_a_sub_ifd_and_skips_the_lossless_raw() {
    let preview = jpeg(1024, 683);
    let progressive = jpeg_with(&[sof(0xC2, 2048, 1366)], 16);
    // I dati del sensore: un JPEG senza perdita, che la WebView non mostra.
    let sensor = jpeg_with(&[sof(0xC3, 6000, 4000)], 64);
    let bytes = Tiff::new(Endian::Ii, 42, 8)
        // IFD0: la miniatura non compressa (compressione 1) e tre SubIFD.
        .ifd(
            8,
            &[
                (0x0103, SHORT, 1, 1),
                (0x0111, LONG, 1, 5000),
                (0x0117, LONG, 1, 64),
                (0x014A, LONG, 3, 100),
            ],
            0,
        )
        .bytes(100, &[200, 0, 0, 0, 44, 1, 0, 0, 144, 1, 0, 0])
        .ifd(
            200,
            &[
                (0x0103, SHORT, 1, 7),
                (0x0111, LONG, 1, 6000),
                (0x0117, LONG, 1, sensor.len() as u32),
            ],
            0,
        )
        .ifd(
            300,
            &[
                (0x0103, SHORT, 1, 7),
                (0x0111, LONG, 1, 8000),
                (0x0117, LONG, 1, preview.len() as u32),
            ],
            0,
        )
        .ifd(
            400,
            &[
                (0x0103, SHORT, 1, 6),
                (0x0111, LONG, 1, 9000),
                (0x0117, LONG, 1, progressive.len() as u32),
            ],
            0,
        )
        .bytes(5000, &[0; 64])
        .bytes(6000, &sensor)
        .bytes(8000, &preview)
        .bytes(9000, &progressive)
        .build();
    let found = previews(&bytes).unwrap();
    assert_eq!(sizes(&found), vec![(1024, 683), (2048, 1366)]);
    assert_eq!(found.orientation, 1);
    // Un JPEG progressivo si prende: la WebView lo mostra.
    assert_eq!(found.pick(PreviewSize::Large).unwrap().width, 2048);
}

#[test]
fn a_strip_with_more_pieces_or_another_compression_is_not_a_jpeg() {
    let preview = jpeg(800, 600);
    let bytes = Tiff::new(Endian::Ii, 42, 8)
        .ifd(
            8,
            &[
                (0x0103, SHORT, 1, 1),
                (0x0111, LONG, 1, 1000),
                (0x0117, LONG, 1, preview.len() as u32),
            ],
            100,
        )
        .ifd(
            100,
            &[
                (0x0103, SHORT, 1, 6),
                (0x0111, LONG, 2, 300),
                (0x0117, LONG, 2, 308),
            ],
            0,
        )
        .bytes(1000, &preview)
        .build();
    assert!(previews(&bytes).unwrap().candidates.is_empty());
}

#[test]
fn a_dng_without_a_preview_has_no_candidates() {
    let bytes = Tiff::new(Endian::Mm, 42, 8)
        .ifd(8, &[(0x0112, SHORT, 1, 3), (0x0103, SHORT, 1, 1)], 0)
        .build();
    let found = previews(&bytes).unwrap();
    assert!(found.candidates.is_empty());
    assert_eq!(found.orientation, 3);
}

#[test]
fn an_orientation_out_of_range_or_of_another_ifd_is_one() {
    let small = jpeg(300, 200);
    let [a, b] = jif(1000, &small);
    for value in [0, 9, 400] {
        let bytes = Tiff::new(Endian::Ii, 42, 8)
            .ifd(8, &[(0x0112, SHORT, 1, value), a, b], 0)
            .bytes(1000, &small)
            .build();
        assert_eq!(previews(&bytes).unwrap().orientation, 1, "{value}");
    }
    // L'orientamento di IFD1 non conta.
    let bytes = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[a, b], 100)
        .ifd(100, &[(0x0112, SHORT, 1, 6)], 0)
        .bytes(1000, &small)
        .build();
    assert_eq!(previews(&bytes).unwrap().orientation, 1);
}

#[test]
fn orf_and_rw2_have_their_own_signatures() {
    let preview = jpeg(1280, 960);
    let [a, b] = jif(1000, &preview);
    // ORF: `IIRO` e `MMOR`.
    for endian in [Endian::Ii, Endian::Mm] {
        let bytes = Tiff::new(endian, 0x4F52, 8)
            .ifd(8, &[a, b], 0)
            .bytes(1000, &preview)
            .build();
        assert_eq!(
            &bytes[..4],
            if matches!(endian, Endian::Ii) {
                b"IIRO"
            } else {
                b"MMOR"
            }
        );
        assert_eq!(sizes(&previews(&bytes).unwrap()), vec![(1280, 960)]);
    }
    // RW2: `IIU\0`, il JPEG dal tag 0x002E.
    let rw2 = |magic: u16| {
        Tiff::new(Endian::Ii, magic, 8)
            .ifd(
                8,
                &[
                    (0x0112, SHORT, 1, 8),
                    (0x002E, UNDEFINED, preview.len() as u32, 1000),
                ],
                0,
            )
            .bytes(1000, &preview)
            .build()
    };
    let bytes = rw2(0x0055);
    assert_eq!(&bytes[..4], b"IIU\0");
    let found = previews(&bytes).unwrap();
    assert_eq!(sizes(&found), vec![(1280, 960)]);
    assert_eq!(found.orientation, 8);
    // In un TIFF qualunque il tag 0x002E non è un JPEG.
    assert!(previews(&rw2(42)).unwrap().candidates.is_empty());
}

#[test]
fn two_equal_candidates_are_one() {
    let preview = jpeg(640, 480);
    let [a, b] = jif(1000, &preview);
    let bytes = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[a, b], 100)
        .ifd(
            100,
            &[
                (0x0103, SHORT, 1, 6),
                (0x0111, LONG, 1, 1000),
                (0x0117, LONG, 1, preview.len() as u32),
            ],
            0,
        )
        .bytes(1000, &preview)
        .build();
    assert_eq!(previews(&bytes).unwrap().candidates.len(), 1);
}

#[test]
fn a_loop_of_ifds_or_an_ifd_pointing_to_itself_is_malformed() {
    let looped = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[], 100)
        .ifd(100, &[], 8)
        .build();
    assert!(matches!(previews(&looped), Err(RawError::Malformed)));
    let itself = Tiff::new(Endian::Mm, 42, 8).ifd(8, &[], 8).build();
    assert!(matches!(previews(&itself), Err(RawError::Malformed)));
    // Un SubIFD che torna a IFD0.
    let back = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[(0x014A, LONG, 1, 8)], 0)
        .build();
    assert!(matches!(previews(&back), Err(RawError::Malformed)));
}

#[test]
fn at_most_sixteen_ifds_are_followed() {
    let chain = |count: u32| {
        let mut tiff = Tiff::new(Endian::Ii, 42, 8);
        for i in 0..count {
            let at = 8 + i * 6;
            let next = if i + 1 == count { 0 } else { at + 6 };
            tiff.ifd(at, &[], next);
        }
        tiff.build()
    };
    assert!(previews(&chain(MAX_IFDS as u32)).is_ok());
    assert!(matches!(
        previews(&chain(MAX_IFDS as u32 + 1)),
        Err(RawError::TooLarge)
    ));
    // E una voce che dichiara più SubIFD del tetto.
    let many = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[(0x014A, LONG, MAX_IFDS as u32 + 1, 100)], 0)
        .bytes(100, &[0; 4 * (MAX_IFDS + 1)])
        .build();
    assert!(matches!(previews(&many), Err(RawError::TooLarge)));
}

#[test]
fn an_ifd_with_too_many_entries_is_refused_before_reading_them() {
    let declaring = |count: u16| {
        let mut bytes = Tiff::new(Endian::Ii, 42, 8).build();
        bytes.extend_from_slice(&count.to_le_bytes());
        // Le voci ci sono tutte, a zero, e il prossimo IFD è zero.
        bytes.resize(bytes.len() + usize::from(count) * 12 + 4, 0);
        bytes
    };
    assert!(previews(&declaring(MAX_IFD_ENTRIES as u16)).is_ok());
    assert!(matches!(
        previews(&declaring(MAX_IFD_ENTRIES as u16 + 1)),
        Err(RawError::TooLarge)
    ));
    // Un `u16` non dice 70 000: il più che può dire è 65 535, e senza i byte
    // delle voci.
    let mut huge = Tiff::new(Endian::Ii, 42, 8).build();
    huge.extend_from_slice(&u16::MAX.to_le_bytes());
    assert!(matches!(previews(&huge), Err(RawError::TooLarge)));
}

#[test]
fn an_offset_beyond_the_end_is_malformed() {
    let bytes = Tiff::new(Endian::Ii, 42, 4000).build();
    assert!(matches!(previews(&bytes), Err(RawError::Malformed)));
    let bytes = Tiff::new(Endian::Ii, 42, u32::MAX).build();
    assert!(matches!(previews(&bytes), Err(RawError::Malformed)));
    // Un IFD che comincia dentro e finisce fuori.
    let mut cut = Tiff::new(Endian::Ii, 42, 8).build();
    cut.extend_from_slice(&3u16.to_le_bytes());
    cut.extend_from_slice(&[0; 20]);
    assert!(matches!(previews(&cut), Err(RawError::Malformed)));
    // I SubIFD in un elenco oltre la fine.
    let sub = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[(0x014A, LONG, 2, 1 << 20)], 0)
        .build();
    assert!(matches!(previews(&sub), Err(RawError::Malformed)));
}

#[test]
fn a_jpeg_pointer_out_of_the_file_is_skipped() {
    let preview = jpeg(640, 480);
    let bytes = Tiff::new(Endian::Ii, 42, 8)
        .ifd(
            8,
            &[(0x0201, LONG, 1, 1000), (0x0202, LONG, 1, u32::MAX)],
            100,
        )
        .ifd(
            100,
            &[(0x0201, LONG, 1, u32::MAX), (0x0202, LONG, 1, 10)],
            0,
        )
        .bytes(1000, &preview)
        .build();
    assert!(previews(&bytes).unwrap().candidates.is_empty());
}

#[test]
fn a_bad_jpeg_is_skipped() {
    let no_sof = jpeg_with(&[segment(0xDB, &[0; 65])], 16);
    let not_jpeg = b"\x89PNG\r\n\x1a\n........".to_vec();
    let zero_side = jpeg_with(&[sof(0xC0, 0, 480)], 16);
    let good = jpeg(320, 240);
    let mut tiff = Tiff::new(Endian::Ii, 42, 8);
    tiff.ifd(8, &jif(1000, &no_sof), 100)
        .ifd(100, &jif(2000, &not_jpeg), 200)
        .ifd(200, &jif(3000, &zero_side), 300)
        // Un JPEG lungo 0.
        .ifd(300, &[(0x0201, LONG, 1, 4000), (0x0202, LONG, 1, 0)], 400)
        // Un JPEG troncato: la lunghezza taglia il `SOF`.
        .ifd(400, &[(0x0201, LONG, 1, 4000), (0x0202, LONG, 1, 6)], 0)
        .bytes(1000, &no_sof)
        .bytes(2000, &not_jpeg)
        .bytes(3000, &zero_side)
        .bytes(4000, &good);
    assert!(previews(&tiff.build()).unwrap().candidates.is_empty());
}

// --- Un lettore sparso che conta i byte ---------------------------------------

/// Un file lungo `len`, a zero tranne i pezzi dati, che conta i byte letti:
/// nessun byte vero oltre i pezzi.
struct Sparse {
    len: u64,
    pieces: Vec<(u64, Vec<u8>)>,
    pos: u64,
    read: u64,
}

impl Sparse {
    fn new(len: u64, pieces: Vec<(u64, Vec<u8>)>) -> Sparse {
        Sparse {
            len,
            pieces,
            pos: 0,
            read: 0,
        }
    }
}

impl Read for Sparse {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len {
            return Ok(0);
        }
        let n = buf.len().min((self.len - self.pos) as usize);
        let out = &mut buf[..n];
        out.fill(0);
        let (start, stop) = (self.pos, self.pos + n as u64);
        for (at, data) in &self.pieces {
            let end = at + data.len() as u64;
            let from = start.max(*at);
            let to = stop.min(end);
            if from < to {
                out[(from - start) as usize..(to - start) as usize]
                    .copy_from_slice(&data[(from - at) as usize..(to - at) as usize]);
            }
        }
        self.pos = stop;
        self.read += n as u64;
        Ok(n)
    }
}

impl Seek for Sparse {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.pos = match pos {
            SeekFrom::Start(at) => at,
            SeekFrom::End(delta) => self.len.checked_add_signed(delta).unwrap(),
            SeekFrom::Current(delta) => self.pos.checked_add_signed(delta).unwrap(),
        };
        Ok(self.pos)
    }
}

const MIB: u64 = 1024 * 1024;

#[test]
fn a_sparse_raw_of_fifty_mib_reads_the_jpeg_and_little_more() {
    // Un NEF: IFD0 con la miniatura e un SubIFD lontano, che dice dove sta il
    // JPEG grande; il resto sono i dati del sensore, mai letti.
    let big = jpeg_with(
        &[segment(0xDB, &[0; 65]), sof(0xC0, 4000, 3000)],
        MIB as usize,
    );
    let thumb = jpeg(160, 120);
    let len = 50 * MIB;
    let sub_at = 49 * MIB as u32;
    let big_at = 30 * MIB as u32;
    let head = Tiff::new(Endian::Mm, 42, 8)
        .ifd(
            8,
            &[
                (0x0112, SHORT, 1, 6),
                (0x014A, LONG, 1, sub_at),
                (0x0201, LONG, 1, 1000),
                (0x0202, LONG, 1, thumb.len() as u32),
            ],
            0,
        )
        .bytes(1000, &thumb)
        .build();
    let sub = {
        let mut tiff = Tiff::new(Endian::Mm, 42, 8);
        tiff.ifd(0, &jif(big_at, &big), 0);
        tiff.build()
    };
    let mut file = Sparse::new(
        len,
        vec![
            (0, head),
            (u64::from(sub_at), sub),
            (u64::from(big_at), big.clone()),
        ],
    );
    let found = embedded_jpegs(&mut file, len).unwrap();
    assert_eq!(found.orientation, 6);
    let chosen = found.pick(PreviewSize::Large).unwrap();
    assert_eq!((chosen.width, chosen.height), (4000, 3000));
    assert_eq!(read_jpeg(&mut file, &chosen).unwrap(), big);
    assert!(
        file.read <= big.len() as u64 + 256 * 1024,
        "letti {} byte per un JPEG di {}",
        file.read,
        big.len()
    );
}

#[test]
fn a_jpeg_over_eight_mib_is_skipped_and_one_of_eight_is_taken() {
    let header = jpeg(1920, 1280);
    let make = |declared: u64| {
        let head = Tiff::new(Endian::Ii, 42, 8)
            .ifd(
                8,
                &[(0x0201, LONG, 1, 4096), (0x0202, LONG, 1, declared as u32)],
                0,
            )
            .build();
        Sparse::new(20 * MIB, vec![(0, head), (4096, header.clone())])
    };
    let mut twelve = make(12 * MIB);
    assert!(embedded_jpegs(&mut twelve, 20 * MIB)
        .unwrap()
        .candidates
        .is_empty());
    let mut eight = make(MAX_JPEG_BYTES);
    let found = embedded_jpegs(&mut eight, 20 * MIB).unwrap();
    assert_eq!(found.candidates.len(), 1);
    assert_eq!(found.candidates[0].len, MAX_JPEG_BYTES);
    // E `read_jpeg` non legge un JPEG che nessuno ha misurato.
    let wrong = JpegRange {
        offset: 0,
        len: MAX_JPEG_BYTES + 1,
        width: 1,
        height: 1,
    };
    assert!(matches!(
        read_jpeg(&mut make(1), &wrong),
        Err(RawError::TooLarge)
    ));
}

// --- CR3 --------------------------------------------------------------------

fn bmff(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = u32::try_from(payload.len() + 8)
        .unwrap()
        .to_be_bytes()
        .to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    out
}

fn uuid_box(id: &[u8; 16], payload: &[u8]) -> Vec<u8> {
    let mut inner = id.to_vec();
    inner.extend_from_slice(payload);
    bmff(b"uuid", &inner)
}

/// `THMB` o `PRVW`: 8 byte di intestazione loro, la lunghezza, 4 byte, il
/// JPEG.
fn cr3_jpeg_box(kind: &[u8; 4], jpeg: &[u8]) -> Vec<u8> {
    let mut payload = vec![0u8; 8];
    payload.extend_from_slice(&u32::try_from(jpeg.len()).unwrap().to_be_bytes());
    payload.extend_from_slice(&[0, 0, 0, 0]);
    payload.extend_from_slice(jpeg);
    bmff(kind, &payload)
}

fn ftyp(brand: &[u8; 4]) -> Vec<u8> {
    let mut payload = brand.to_vec();
    payload.extend_from_slice(&[0, 0, 0, 1]);
    payload.extend_from_slice(brand);
    bmff(b"ftyp", &payload)
}

/// Un CR3 con le scatole minime: `ftyp`, `moov` con la `uuid` di Canon
/// (`CMT1` con l'orientamento e `THMB`), la `uuid` con `PRVW`, e un `mdat`
/// con la misura a 64 bit.
fn cr3(orientation: u16) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let thumb = jpeg(160, 120);
    let preview = jpeg(1620, 1080);
    let cmt1 = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &[(0x0112, SHORT, 1, u32::from(orientation))], 0)
        .build();
    let canon = uuid_box(
        &CR3_CANON_UUID,
        &[
            bmff(b"CNCV", b"CanonCR3_001/00.09.00/00.00.00"),
            bmff(b"CMT1", &cmt1),
            cr3_jpeg_box(b"THMB", &thumb),
        ]
        .concat(),
    );
    let moov = bmff(b"moov", &[canon, bmff(b"mvhd", &[0; 100])].concat());
    let mut prvw_payload = vec![0, 0, 0, 0, 0, 0, 0, 1];
    prvw_payload.extend_from_slice(&cr3_jpeg_box(b"PRVW", &preview));
    let prvw = uuid_box(&CR3_PREVIEW_UUID, &prvw_payload);
    let mut mdat = 1u32.to_be_bytes().to_vec();
    mdat.extend_from_slice(b"mdat");
    mdat.extend_from_slice(&(16u64 + 32).to_be_bytes());
    mdat.extend_from_slice(&[0xAB; 32]);
    let bytes = [ftyp(b"crx "), moov, prvw, mdat].concat();
    (bytes, thumb, preview)
}

#[test]
fn a_cr3_gives_thmb_and_prvw_with_the_orientation_of_cmt1() {
    let (bytes, thumb, preview) = cr3(6);
    let found = previews(&bytes).unwrap();
    assert_eq!(sizes(&found), vec![(160, 120), (1620, 1080)]);
    assert_eq!(found.orientation, 6);
    let mut reader = Cursor::new(&bytes);
    let large = found.pick(PreviewSize::Large).unwrap();
    assert_eq!(read_jpeg(&mut reader, &large).unwrap(), preview);
    assert_eq!(found.pick(PreviewSize::Small), Some(large));
    assert_eq!(read_jpeg(&mut reader, &found.candidates[0]).unwrap(), thumb);
}

#[test]
fn a_cr3_that_is_any_mp4_is_not_a_raw() {
    let mp4 = [ftyp(b"isom"), bmff(b"moov", &[0; 16])].concat();
    assert!(matches!(previews(&mp4), Err(RawError::NotRaw)));
    // `ftyp` senza la marca.
    let short = bmff(b"ftyp", b"cr");
    assert!(matches!(previews(&short), Err(RawError::NotRaw)));
}

#[test]
fn a_box_of_size_zero_or_larger_than_the_file_is_malformed() {
    let zero = [ftyp(b"crx "), 0u32.to_be_bytes().to_vec(), b"moov".to_vec()].concat();
    assert!(matches!(previews(&zero), Err(RawError::Malformed)));
    let mut huge = [ftyp(b"crx "), bmff(b"moov", &[0; 16])].concat();
    let at = ftyp(b"crx ").len();
    huge[at..at + 4].copy_from_slice(&1_000_000u32.to_be_bytes());
    assert!(matches!(previews(&huge), Err(RawError::Malformed)));
    // Una scatola dentro `moov` più grande di `moov`.
    let inner = {
        let mut inner = bmff(b"uuid", &[0; 40]);
        inner[..4].copy_from_slice(&100u32.to_be_bytes());
        inner
    };
    let spilling = [ftyp(b"crx "), bmff(b"moov", &inner), vec![0; 200]].concat();
    assert!(matches!(previews(&spilling), Err(RawError::Malformed)));
    // Una misura a 64 bit che trabocca.
    let mut large = [ftyp(b"crx ")].concat();
    large.extend_from_slice(&1u32.to_be_bytes());
    large.extend_from_slice(b"mdat");
    large.extend_from_slice(&u64::MAX.to_be_bytes());
    assert!(matches!(previews(&large), Err(RawError::Malformed)));
    // Una `uuid` più corta del suo identificativo.
    let uuid = [ftyp(b"crx "), bmff(b"uuid", &[0; 8])].concat();
    assert!(matches!(previews(&uuid), Err(RawError::Malformed)));
}

/// `levels` scatole `moov` una dentro l'altra, con un `THMB` nell'ultima.
fn nested(levels: usize) -> Vec<u8> {
    let mut inner = cr3_jpeg_box(b"THMB", &jpeg(160, 120));
    for _ in 0..levels {
        inner = bmff(b"moov", &inner);
    }
    [ftyp(b"crx "), inner].concat()
}

#[test]
fn at_most_eight_levels_of_boxes() {
    // Sette `moov` e il `THMB` all'ottavo livello.
    let found = previews(&nested(MAX_BOX_DEPTH - 1)).unwrap();
    assert_eq!(found.candidates.len(), 1);
    // Otto `moov` e il `THMB` al nono.
    assert!(matches!(
        previews(&nested(MAX_BOX_DEPTH)),
        Err(RawError::TooLarge)
    ));
}

#[test]
fn at_most_ten_thousand_boxes() {
    let free = bmff(b"free", &[]);
    let boxes = |count: usize| {
        let mut bytes = ftyp(b"crx ");
        for _ in 0..count {
            bytes.extend_from_slice(&free);
        }
        bytes
    };
    // `ftyp` è la prima.
    assert!(previews(&boxes(MAX_BOXES - 1)).is_ok());
    assert!(matches!(
        previews(&boxes(MAX_BOXES)),
        Err(RawError::TooLarge)
    ));
}

#[test]
fn at_most_sixty_four_candidates() {
    let many = |count: usize| {
        let mut bytes = ftyp(b"crx ");
        for i in 0..count {
            bytes.extend_from_slice(&cr3_jpeg_box(b"THMB", &jpeg(160 + i as u16, 120)));
        }
        bytes
    };
    assert_eq!(
        previews(&many(MAX_CANDIDATES)).unwrap().candidates.len(),
        MAX_CANDIDATES
    );
    assert!(matches!(
        previews(&many(MAX_CANDIDATES + 1)),
        Err(RawError::TooLarge)
    ));
}

#[test]
fn a_thmb_whose_jpeg_leaves_the_box_is_skipped() {
    let jpeg = jpeg(160, 120);
    let mut thmb = cr3_jpeg_box(b"THMB", &jpeg);
    // La lunghezza dichiarata va oltre la scatola, dentro il file.
    thmb[16..20].copy_from_slice(&(jpeg.len() as u32 + 64).to_be_bytes());
    let bytes = [ftyp(b"crx "), thmb, vec![0; 128]].concat();
    // La coda è fatta di scatole di misura 0: rotte.
    assert!(previews(&bytes).is_err());
    let bytes = [
        ftyp(b"crx "),
        {
            let mut thmb = cr3_jpeg_box(b"THMB", &jpeg);
            thmb[16..20].copy_from_slice(&(jpeg.len() as u32 + 64).to_be_bytes());
            thmb
        },
        bmff(b"free", &[0; 120]),
    ]
    .concat();
    assert!(previews(&bytes).unwrap().candidates.is_empty());
}

// --- RAF --------------------------------------------------------------------

fn raf(jpeg: &[u8]) -> Vec<u8> {
    let mut bytes = RAF_SIGNATURE.to_vec();
    bytes.extend_from_slice(b"0201FF129502");
    bytes.resize(84, 0);
    bytes.extend_from_slice(&256u32.to_be_bytes());
    bytes.extend_from_slice(&u32::try_from(jpeg.len()).unwrap().to_be_bytes());
    bytes.resize(256, 0);
    bytes.extend_from_slice(jpeg);
    bytes.extend_from_slice(&[0; 64]);
    bytes
}

#[test]
fn a_raf_gives_its_jpeg_with_the_orientation_of_its_exif() {
    let preview = jpeg_with_exif(1920, 1280, 8);
    let found = previews(&raf(&preview)).unwrap();
    assert_eq!(sizes(&found), vec![(1920, 1280)]);
    assert_eq!(found.orientation, 8);
    // Senza EXIF, 1.
    let found = previews(&raf(&jpeg(1920, 1280))).unwrap();
    assert_eq!(found.orientation, 1);
    // Un'intestazione corta.
    let short = RAF_SIGNATURE.to_vec();
    assert!(matches!(previews(&short), Err(RawError::Malformed)));
}

// --- Nessuna forma ------------------------------------------------------------

#[test]
fn an_empty_or_unknown_file_is_not_a_raw() {
    assert!(matches!(previews(&[]), Err(RawError::NotRaw)));
    assert!(matches!(previews(b"II"), Err(RawError::NotRaw)));
    assert!(matches!(previews(b"RAW finto"), Err(RawError::NotRaw)));
    assert!(matches!(
        previews(b"II\x2b\0\x08\0\0\0"),
        Err(RawError::NotRaw)
    ));
    assert!(matches!(
        previews(b"II\x2a\0\0\0\0\0"),
        Err(RawError::Malformed)
    ));
}

// --- Il lavoro di un file ostile ----------------------------------------------

/// Un JPEG che non arriva mai al `SOF`: `SOI` e `segments` segmenti `APP0`
/// vuoti, tutti da camminare prima di arrendersi.
fn app_chain(segments: usize) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8];
    for _ in 0..segments {
        out.extend_from_slice(&segment(0xE0, &[]));
    }
    out
}

#[test]
fn an_rw2_with_sixteen_thousand_entries_on_one_offset_checks_it_once() {
    let chain = app_chain(1000);
    let preview = jpeg(1280, 960);
    let ifd_len = 2 + 12 * MAX_IFD_ENTRIES as u32 + 4;
    let chain_at = 8 + ifd_len * MAX_IFDS as u32;
    let preview_at = chain_at + chain.len() as u32;
    let mut tiff = Tiff::new(Endian::Ii, 0x0055, 8);
    for index in 0..MAX_IFDS as u32 {
        let at = 8 + index * ifd_len;
        let last = index + 1 == MAX_IFDS as u32;
        let mut fields = vec![(0x002E, UNDEFINED, chain.len() as u32, chain_at); MAX_IFD_ENTRIES];
        if last {
            // Fra sedicimila voci uguali, l'anteprima vera si trova lo stesso.
            fields[MAX_IFD_ENTRIES - 1] = (0x002E, UNDEFINED, preview.len() as u32, preview_at);
        }
        let next = if last { 0 } else { at + ifd_len };
        tiff.ifd(at, &fields, next);
    }
    let bytes = tiff
        .bytes(chain_at, &chain)
        .bytes(preview_at, &preview)
        .build();
    let len = bytes.len() as u64;
    let mut file = Sparse::new(len, vec![(0, bytes)]);
    let found = embedded_jpegs(&mut file, len).unwrap();
    assert_eq!(sizes(&found), vec![(1280, 960)]);
    // Gli IFD si leggono tutti (192 KiB); la catena una volta sola.
    assert!(file.read <= 256 * 1024, "letti {} byte", file.read);
}

#[test]
fn a_cr3_with_ten_thousand_thmb_boxes_ends_at_once() {
    let chain = app_chain(100);
    let mut bytes = ftyp(b"crx ");
    for _ in 0..MAX_BOXES - 2 {
        bytes.extend_from_slice(&cr3_jpeg_box(b"THMB", &chain));
    }
    let len = bytes.len() as u64;
    let mut file = Sparse::new(len, vec![(0, bytes)]);
    assert!(matches!(
        embedded_jpegs(&mut file, len),
        Err(RawError::TooLarge)
    ));
    // Le intestazioni delle scatole, non i JPEG dentro.
    assert!(file.read <= 256 * 1024, "letti {} byte", file.read);
}

#[test]
fn the_whole_file_has_a_byte_budget() {
    // Un candidato di 8 MiB fatti di riempimento `FF`: il cammino lo
    // leggerebbe tutto, un byte alla volta.
    let mut fill = vec![0xFF; MAX_JPEG_BYTES as usize];
    fill[1] = 0xD8;
    let head = Tiff::new(Endian::Ii, 42, 8)
        .ifd(8, &jif(4096, &fill), 0)
        .build();
    let len = 4096 + MAX_JPEG_BYTES;
    let mut file = Sparse::new(len, vec![(0, head), (4096, fill)]);
    assert!(matches!(
        embedded_jpegs(&mut file, len),
        Err(RawError::TooLarge)
    ));
    assert!(
        file.read <= MAX_STRUCTURE_BYTES + 64 * 1024,
        "letti {} byte",
        file.read
    );
}
