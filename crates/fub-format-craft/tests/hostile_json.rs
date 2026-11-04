//! Un JSON ostile nei contenitori: 64 MiB di `[0,0,…]` non diventano un
//! documento in memoria. Si contano i byte che il crate chiede all'allocatore
//! mentre legge, non la memoria del processo.
//!
//! Un test solo nel file: l'allocatore che conta è di tutto il processo, e un
//! altro test in parallelo sporcherebbe la misura.

use std::alloc::{GlobalAlloc, Layout, System};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicUsize, Ordering};

use fub_format_craft::container::{
    embedded_preview_from, read_meta, FIGCRAFT_DOCUMENT, MAX_FILE_BYTES,
};
use fub_format_craft::{CraftApp, PreviewSize};

/// L'allocatore di sistema, con i byte vivi e il massimo da quando si azzera.
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: si passa la stessa `layout` all'allocatore di sistema.
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            let live = LIVE.fetch_add(layout.size(), Ordering::SeqCst) + layout.size();
            PEAK.fetch_max(live, Ordering::SeqCst);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` viene da `alloc` con la stessa `layout`.
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::SeqCst);
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// I byte chiesti in più, al massimo, mentre gira `work`.
fn extra_peak<T>(work: impl FnOnce() -> T) -> (T, usize) {
    let base = LIVE.load(Ordering::SeqCst);
    PEAK.store(base, Ordering::SeqCst);
    let result = work();
    (result, PEAK.load(Ordering::SeqCst).saturating_sub(base))
}

/// Pochi MiB: un pezzo di lettura, i buffer dello ZIP e dello gzip.
const FEW_MIB: usize = 4 * 1024 * 1024;

/// `[0,0,…,0]` lungo esattamente `len` byte (dispari, almeno 3).
fn zeros(len: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(len);
    bytes.push(b'[');
    while bytes.len() + 2 < len {
        bytes.extend_from_slice(b"0,");
    }
    bytes.extend_from_slice(b"0]");
    bytes
}

/// Lo stesso JSON, prodotto mentre si legge: il file non sta in memoria.
struct LazyZeros {
    len: u64,
    at: u64,
}

impl LazyZeros {
    fn byte(&self, at: u64) -> u8 {
        if at == 0 {
            b'['
        } else if at + 1 == self.len {
            b']'
        } else if at % 2 == 1 {
            b'0'
        } else {
            b','
        }
    }
}

impl Read for LazyZeros {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let mut n = 0;
        for slot in out.iter_mut() {
            if self.at >= self.len {
                break;
            }
            *slot = self.byte(self.at);
            self.at += 1;
            n += 1;
        }
        Ok(n)
    }
}

impl Seek for LazyZeros {
    fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
        self.at = match to {
            SeekFrom::Start(at) => at,
            SeekFrom::End(back) => self.len.saturating_add_signed(back),
            SeekFrom::Current(step) => self.at.saturating_add_signed(step),
        };
        Ok(self.at)
    }
}

#[test]
fn sessantaquattro_mib_di_zeri_non_diventano_un_documento() {
    let len = MAX_FILE_BYTES - 1;

    // FigCraft: `document.json` in Deflate dentro lo ZIP.
    let figcraft = {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(false);
        writer.start_file(FIGCRAFT_DOCUMENT, options).unwrap();
        writer.write_all(&zeros(len)).unwrap();
        writer.finish().unwrap().into_inner()
    };
    let (contents, extra) = extra_peak(|| read_meta(CraftApp::FigCraft, &figcraft));
    let contents = contents.unwrap();
    assert_eq!((contents.title, contents.text.len()), (None, 0));
    assert!(extra < FEW_MIB, "FigCraft: {extra} byte in più");
    drop(figcraft);

    // VectorCraft in memoria.
    let vectorcraft = zeros(len);
    let (contents, extra) = extra_peak(|| read_meta(CraftApp::VectorCraft, &vectorcraft));
    assert_eq!(contents.unwrap().title, None);
    assert!(extra < FEW_MIB, "VectorCraft: {extra} byte in più");
    drop(vectorcraft);

    // VectorCraft letto a pezzi da un file, per l'anteprima e la versione.
    let mut file = LazyZeros {
        len: len as u64,
        at: 0,
    };
    let (embedded, extra) = extra_peak(|| {
        embedded_preview_from(
            CraftApp::VectorCraft,
            &mut file,
            len as u64,
            PreviewSize::Small,
            MAX_FILE_BYTES as u64,
        )
    });
    let embedded = embedded.unwrap();
    assert_eq!(embedded.format_version, Ok(None));
    assert_eq!(embedded.png, Ok(None));
    assert!(extra < FEW_MIB, "anteprima: {extra} byte in più");
}
