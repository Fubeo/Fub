//! L'anteprima di un file VectorCraft, PhotoCraft o FigCraft: la versione del
//! formato e l'immagine che il file porta
//! (`container::embedded_preview_from`).
//!
//! Uno ZIP (PhotoCraft, FigCraft) si legge a pezzi da [`read_from`]: la coda,
//! la directory centrale e le voci che servono, qualunque sia il peso del
//! file. Un `.vectorcraft`, o uno ZIP che arriva dall'host, si legge dai byte
//! interi con [`read`].

use std::io::{self, Cursor, Read, Seek, SeekFrom};

use fub_format_craft::container::{embedded_preview_from, ContainerError, Embedded};
use fub_format_craft::{CraftApp, CraftPreview, Missing, PreviewImage, PreviewOrigin, PreviewSize};

/// Completa `preview` coi byte del file, interi: letti a pezzi fino a `max`,
/// con la revisione degli stessi pezzi già nella risposta, o dall'host quando
/// la lease non si apre. Un file che non si apre come il suo formato è
/// `missing: unreadable`; uno che si apre senza un'anteprima resta `absent`;
/// un JSON prima dei blob oltre `max` è `missing: over_limit`.
pub(super) fn read(
    preview: &mut CraftPreview,
    app: CraftApp,
    bytes: &[u8],
    size: PreviewSize,
    max: u64,
) {
    let found = embedded_preview_from(app, &mut Cursor::new(bytes), bytes.len() as u64, size, max);
    apply(preview, found, max);
}

/// Completa `preview` di uno ZIP lungo `len` leggendo da `reader` solo la
/// coda, la directory centrale e le voci che servono. La revisione resta
/// `None`: senza tutti i byte non se ne sa l'impronta. Il primo errore di
/// `reader` torna a chi chiama, anche quando il contenitore ha risposto lo
/// stesso: chi chiama sa se il file è cambiato nel frattempo.
pub(super) fn read_from<R: Read + Seek>(
    preview: &mut CraftPreview,
    app: CraftApp,
    reader: &mut R,
    len: u64,
    size: PreviewSize,
) -> io::Result<()> {
    preview.revision = None;
    let mut watched = Watched {
        inner: reader,
        error: None,
    };
    // Uno ZIP letto a pezzi non ha un peso massimo: il tetto vale solo per il
    // JSON di un `.vectorcraft`, che qui non passa.
    let found = embedded_preview_from(app, &mut watched, len, size, u64::MAX);
    if let Some(error) = watched.error {
        return Err(error);
    }
    apply(preview, found, u64::MAX);
    Ok(())
}

/// Ciò che il contenitore ha trovato, in `preview`.
fn apply(preview: &mut CraftPreview, found: Result<Embedded, ContainerError>, max: u64) {
    let embedded = match found {
        Ok(embedded) => embedded,
        Err(ContainerError::OverLimit) => {
            preview.missing = Some(Missing::OverLimit);
            preview.limit_bytes = Some(max);
            return;
        }
        Err(_) => {
            preview.missing = Some(Missing::Unreadable);
            return;
        }
    };
    match embedded.format_version {
        Ok(version) => preview.info.format_version = version,
        Err(_) => preview.missing = Some(Missing::Unreadable),
    }
    let image = embedded
        .png
        .ok()
        .flatten()
        .and_then(|png| PreviewImage::from_png(&png.bytes));
    if image.is_some() {
        preview.origin = PreviewOrigin::File;
        preview.image = image;
        preview.missing = None;
    }
}

/// Un lettore che ricorda il suo primo errore: il contenitore lo traduce nel
/// suo, e chi chiama deve poter ancora riconoscere un file cambiato.
struct Watched<'a, R> {
    inner: &'a mut R,
    error: Option<io::Error>,
}

impl<R> Watched<'_, R> {
    fn keep<T>(&mut self, result: io::Result<T>) -> io::Result<T> {
        result.map_err(|error| {
            let copy = io::Error::new(error.kind(), "lettura a pezzi");
            if self.error.is_none() {
                self.error = Some(error);
            }
            copy
        })
    }
}

impl<R: Read> Read for Watched<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let result = self.inner.read(buf);
        self.keep(result)
    }
}

impl<R: Seek> Seek for Watched<'_, R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let result = self.inner.seek(pos);
        self.keep(result)
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use camino::Utf8PathBuf;
    use fub_abi::model::DocId;
    use fub_format_craft::PreviewSubject;
    use fub_kernel::{FormatRegistry, Workspace};

    use super::super::super::ranged::{is_stale, Ranged};
    use super::*;

    fn pcraft() -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", stored).unwrap();
        zip.write_all(br#"{"format_version":5}"#).unwrap();
        zip.finish().unwrap().into_inner()
    }

    /// Un `.pcraft` riscritto dopo l'apertura della lease: l'errore `Stale`
    /// torna a chi chiama così com'è, e chi chiama riprova.
    #[test]
    fn a_pcraft_rewritten_while_read_gives_back_the_stale_error() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::write(root.join("a.pcraft"), pcraft()).unwrap();
        let ws = Workspace::new(&root, FormatRegistry::new()).unwrap();
        let ranged = Ranged::new(ws.resource_reader());
        let doc = DocId::new("a.pcraft");
        let mut file = ranged.open(&doc).unwrap();
        let len = file.len();
        let mut rewritten = pcraft();
        rewritten.extend_from_slice(b"altro");
        std::fs::write(root.join("a.pcraft"), rewritten).unwrap();
        let mut preview = super::super::empty(
            &doc,
            None,
            PreviewSize::Small,
            PreviewSubject::PhotoCraft,
            len,
        );
        let error = read_from(
            &mut preview,
            CraftApp::PhotoCraft,
            &mut file,
            len,
            PreviewSize::Small,
        )
        .unwrap_err();
        assert!(is_stale(&error), "{error:?}");
    }
}
