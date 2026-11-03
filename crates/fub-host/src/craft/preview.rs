//! L'anteprima di un file Craft: il `CraftPreview` di un documento per una
//! misura, smistato per soggetto.
//!
//! Il soggetto viene dal formato del documento, quando è una delle quattro
//! famiglie dei provider Craft; altrimenti dall'estensione
//! ([`PreviewSubject::of_extension`]): una foto RAW, un PDF (anche quando ha
//! il suo provider, che resta per la ricerca), un documento di testo. Un file
//! di nessun soggetto è rifiutato.
//!
//! Prima la cache del bundle, poi il file. La voce in cache sta a
//! [`cache_key`] della revisione e della misura, e vale solo se si legge, è
//! della [`PREVIEW_VERSION`] e ripete lo stesso documento, la stessa revisione
//! e la stessa misura: una voce rotta, di un'altra versione o di un altro file
//! vale una voce che non c'è. Altrimenti si legge il file col lettore del suo
//! soggetto: [`craft_files`] per i disegni, le immagini e i progetti, [`xmp`]
//! per un XMP, [`raw`] e [`documents`] per gli altri.
//!
//! Si scrive in cache solo un'anteprima con l'immagine del file (`origin:
//! file`) e con una revisione, e solo se la revisione non è cambiata mentre si
//! leggeva: una scrittura che non riesce, o che chi chiama non può fare, non
//! toglie l'anteprima. Un file Craft oltre [`MAX_FILE_BYTES`] non si legge: è
//! `missing: over_limit` col peso massimo e il solo peso che l'anagrafe
//! conosce.

use fub_abi::model::DocId;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{FolderScope, HostApi, IndexQuery, IndexResult, Page, VaultEntry};
use fub_abi::{PluginError, Revision};
use fub_format_craft::container::MAX_FILE_BYTES;
use fub_format_craft::{
    cache_key, CraftApp, CraftPreview, Missing, PreviewInfo, PreviewOrigin, PreviewSize,
    PreviewSubject, PREVIEW_VERSION,
};

mod craft_files;
mod documents;
mod raw;
mod xmp;

/// Quante volte si rilegge un file che cambia mentre lo si legge.
const ATTEMPTS: usize = 3;
/// Le voci di una cartella chieste all'anagrafe per volta.
const LISTING_PAGE: u32 = 500;

/// L'anteprima di `doc` alla misura `size`.
///
/// Un documento di nessun soggetto è [`PluginError::BadArgs`] con la chiave
/// `not_craft` del catalogo del bundle; un documento che non c'è, o che
/// sparisce mentre lo si legge, è l'errore dell'host.
pub fn preview(
    host: &mut dyn HostApi,
    doc: &DocId,
    size: PreviewSize,
) -> Result<CraftPreview, PluginError> {
    let subject = subject_of(&*host, doc).ok_or_else(|| {
        PluginError::BadArgs(Text::message(
            "not_craft",
            vec![Arg::text("doc", doc.as_str())],
        ))
    })?;
    let mut last = None;
    for _ in 0..ATTEMPTS {
        let revision = host.document_revision(doc)?;
        if let Some(cached) = cached(&*host, doc, &revision, size) {
            return Ok(cached);
        }
        let folder = Folder::read(&*host, doc)?;
        let preview = read(&*host, doc, &revision, size, subject, &folder)?;
        // La revisione si rilegge dopo i byte: se è cambiata, l'anteprima è di
        // un file che non c'è più e si rifà.
        if host.document_revision(doc)? != revision {
            last = Some(preview);
            continue;
        }
        if preview.origin == PreviewOrigin::File {
            if let (Some(revision), Ok(bytes)) = (&preview.revision, serde_json::to_vec(&preview)) {
                // Una cache che non si scrive non toglie l'anteprima: la
                // prossima volta si rilegge il file.
                let _ = host.cache_write(&cache_key(&revision.0, size), &bytes);
            }
        }
        return Ok(preview);
    }
    // Un file che cambia a ogni lettura: si dà l'ultima, senza cache.
    last.ok_or_else(|| PluginError::Conflict(Text::key("changing")))
}

/// Il soggetto di `doc`: dal formato, se è di un provider Craft, o
/// dall'estensione del nome. Un nome senza estensione, o che è solo
/// un'estensione (`.pdf`), non ne ha.
fn subject_of(host: &dyn HostApi, doc: &DocId) -> Option<PreviewSubject> {
    if let Some(app) = host
        .format_of(doc)
        .and_then(|format| CraftApp::of_format(&format.descriptor.id))
    {
        return Some(app.into());
    }
    let name = doc.as_str().rsplit('/').next().unwrap_or_default();
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => PreviewSubject::of_extension(ext),
        _ => None,
    }
}

/// La voce in cache, se si legge, è di questa versione e ripete documento,
/// revisione e misura.
fn cached(
    host: &dyn HostApi,
    doc: &DocId,
    revision: &Revision,
    size: PreviewSize,
) -> Option<CraftPreview> {
    let bytes = host.cache_read(&cache_key(&revision.0, size)).ok()??;
    let preview: CraftPreview = serde_json::from_slice(&bytes).ok()?;
    (preview.version == PREVIEW_VERSION
        && preview.doc == doc.as_str()
        && preview.revision.as_ref() == Some(revision)
        && preview.size == size)
        .then_some(preview)
}

/// L'anteprima senza immagine, con ciò che si sa senza leggere il file: il
/// file non ne ha una, finché il lettore del soggetto non dice altro.
fn empty(
    doc: &DocId,
    revision: &Revision,
    size: PreviewSize,
    subject: PreviewSubject,
    bytes: u64,
) -> CraftPreview {
    CraftPreview {
        version: PREVIEW_VERSION,
        doc: doc.as_str().to_string(),
        revision: Some(revision.clone()),
        size,
        origin: PreviewOrigin::None,
        queued: false,
        image: None,
        missing: Some(Missing::Absent),
        limit_bytes: None,
        info: PreviewInfo {
            app: subject,
            editor: subject.editor_name().to_string(),
            format_version: None,
            bytes,
            photo: None,
            edits: Vec::new(),
            xmp: None,
        },
        render: None,
    }
}

/// L'anteprima di `doc` col lettore del suo soggetto.
fn read(
    host: &dyn HostApi,
    doc: &DocId,
    revision: &Revision,
    size: PreviewSize,
    subject: PreviewSubject,
    folder: &Folder,
) -> Result<CraftPreview, PluginError> {
    let declared = folder.size_of(doc);
    let mut preview = empty(doc, revision, size, subject, declared.unwrap_or_default());
    let app = match subject {
        PreviewSubject::Raw => {
            raw::read(&mut preview);
            return Ok(preview);
        }
        PreviewSubject::Pdf | PreviewSubject::Document => {
            documents::read(&mut preview);
            return Ok(preview);
        }
        PreviewSubject::VectorCraft => CraftApp::VectorCraft,
        PreviewSubject::PhotoCraft => CraftApp::PhotoCraft,
        PreviewSubject::FigCraft => CraftApp::FigCraft,
        PreviewSubject::Xmp => CraftApp::Xmp,
    };
    if declared.is_some_and(|bytes| bytes > MAX_FILE_BYTES as u64) {
        // D-8: un file troppo grande non si apre nemmeno.
        preview.missing = Some(Missing::OverLimit);
        preview.limit_bytes = Some(MAX_FILE_BYTES as u64);
        return Ok(preview);
    }
    let bytes = host.read_document_bytes(doc)?;
    preview.info.bytes = bytes.len() as u64;
    if app == CraftApp::Xmp {
        xmp::read(&mut preview, doc, &bytes, folder);
    } else {
        craft_files::read(&mut preview, app, &bytes, size);
    }
    Ok(preview)
}

/// I file della cartella del documento, come li conosce l'anagrafe.
struct Folder {
    entries: Vec<VaultEntry>,
}

impl Folder {
    /// I figli diretti della cartella di `doc`, in ordine di id, a pagine.
    fn read(host: &dyn HostApi, doc: &DocId) -> Result<Folder, PluginError> {
        let path = doc
            .as_str()
            .rsplit_once('/')
            .map_or("", |(folder, _)| folder);
        let mut entries = Vec::new();
        loop {
            let offset = u32::try_from(entries.len()).unwrap_or(u32::MAX);
            let result = host.query_index(IndexQuery::Entries {
                of_kind: None,
                within: Some(FolderScope::direct(path)),
                page: Some(Page::new(offset, LISTING_PAGE)),
            })?;
            let IndexResult::Entries(page) = result else {
                break;
            };
            let got = page.items.len();
            entries.extend(page.items);
            if got == 0 || entries.len() as u64 >= u64::from(page.total) {
                break;
            }
        }
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(Folder { entries })
    }

    fn size_of(&self, doc: &DocId) -> Option<u64> {
        self.entries
            .iter()
            .find(|entry| &entry.id == doc)
            .map(|entry| entry.size)
    }

    fn has(&self, id: &str) -> bool {
        self.entries.iter().any(|entry| entry.id.as_str() == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::{DataWrite as _, VaultRead as _};
    use fub_sdk::testing::MemoryHost;

    /// Un PNG minimo: firma, `IHDR` (il CRC non conta per le misure) e `IEND`.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
        out.extend_from_slice(&13u32.to_be_bytes());
        out.extend_from_slice(b"IHDR");
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(b"IEND");
        out.extend_from_slice(&[0, 0, 0, 0]);
        out
    }

    fn vectorcraft(with_preview: bool) -> Vec<u8> {
        use base64::Engine as _;
        let mut doc = serde_json::json!({ "format_version": 4, "title": "Logo" });
        if with_preview {
            doc["preview"] = serde_json::json!({
                "data": base64::engine::general_purpose::STANDARD.encode(png(64, 32)),
            });
        }
        serde_json::to_vec(&doc).unwrap()
    }

    fn host_with(id: &str, bytes: &[u8]) -> MemoryHost {
        let mut host = MemoryHost::new().with_binary_document(id, bytes);
        for provider in fub_format_craft::providers() {
            let format = fub_abi::format::DocumentFormat {
                descriptor: provider.descriptor(),
                capabilities: provider.capabilities(),
            };
            for ext in format.descriptor.extensions.clone() {
                host = host.with_format(&ext, format.clone());
            }
        }
        host
    }

    #[test]
    fn the_second_call_answers_from_the_cache() {
        let mut host = host_with("Disegni/logo.vectorcraft", &vectorcraft(true));
        let doc = DocId::new("Disegni/logo.vectorcraft");
        let first = preview(&mut host, &doc, PreviewSize::Small).unwrap();
        assert_eq!(first.origin, PreviewOrigin::File);
        assert_eq!(first.missing, None);
        assert_eq!(first.info.format_version.as_deref(), Some("4"));
        let image = first.image.as_ref().unwrap();
        assert_eq!((image.width, image.height), (64, 32));
        let key = cache_key(&first.revision.as_ref().unwrap().0, PreviewSize::Small);
        assert_eq!(host.writes_on(&key).0, 1);
        // Il doppio prende la revisione rileggendo i byte: la seconda volta
        // è quella lettura sola, e la risposta viene dalla cache.
        let reads = host.reads_on(doc.as_str()).0;
        let second = preview(&mut host, &doc, PreviewSize::Small).unwrap();
        assert_eq!(second, first);
        assert_eq!(
            host.reads_on(doc.as_str()).0,
            reads + 1,
            "solo la revisione"
        );
        assert_eq!(host.reads_on(&key).0, 1, "la cache ha risposto");
        assert_eq!(host.writes_on(&key).0, 1);
    }

    #[test]
    fn a_broken_or_foreign_cache_entry_is_ignored() {
        let mut host = host_with("logo.vectorcraft", &vectorcraft(true));
        let doc = DocId::new("logo.vectorcraft");
        let revision = host.document_revision(&doc).unwrap();
        let key = cache_key(&revision.0, PreviewSize::Large);
        host.cache_write(&key, b"{rotta").unwrap();
        let fresh = preview(&mut host, &doc, PreviewSize::Large).unwrap();
        assert_eq!(fresh.origin, PreviewOrigin::File);
        for tamper in [
            |p: &mut CraftPreview| p.version = 1,
            |p: &mut CraftPreview| p.doc = "altro.vectorcraft".into(),
            |p: &mut CraftPreview| p.size = PreviewSize::Small,
        ] {
            let mut foreign = fresh.clone();
            foreign.info.format_version = Some("falsa".into());
            tamper(&mut foreign);
            host.cache_write(&key, &serde_json::to_vec(&foreign).unwrap())
                .unwrap();
            let again = preview(&mut host, &doc, PreviewSize::Large).unwrap();
            assert_eq!(again.info.format_version.as_deref(), Some("4"));
        }
    }

    #[test]
    fn a_denied_cache_write_keeps_the_preview() {
        let mut host = host_with("logo.vectorcraft", &vectorcraft(true));
        let doc = DocId::new("logo.vectorcraft");
        let revision = host.document_revision(&doc).unwrap();
        host.denies_write(&cache_key(&revision.0, PreviewSize::Small));
        let out = preview(&mut host, &doc, PreviewSize::Small).unwrap();
        assert_eq!(out.origin, PreviewOrigin::File);
    }

    #[test]
    fn without_a_preview_nothing_is_cached() {
        let mut host = host_with("vuoto.vectorcraft", &vectorcraft(false));
        let doc = DocId::new("vuoto.vectorcraft");
        let out = preview(&mut host, &doc, PreviewSize::Small).unwrap();
        assert_eq!(out.origin, PreviewOrigin::None);
        assert!(out.image.is_none() && out.render.is_none() && !out.queued);
        assert_eq!(out.missing, Some(Missing::Absent));
        let key = cache_key(&out.revision.as_ref().unwrap().0, PreviewSize::Small);
        assert_eq!(host.writes_on(&key).0, 0);
    }

    #[test]
    fn a_raw_a_pdf_and_a_document_come_from_the_extension_and_say_absent() {
        // Un PDF col suo provider: il formato non è Craft, il soggetto viene
        // dall'estensione e il provider resta.
        let mut pdf_format = fub_abi::format::DocumentFormat {
            descriptor: fub_format_craft::providers()[0].descriptor(),
            capabilities: fub_format_craft::providers()[0].capabilities(),
        };
        pdf_format.descriptor.id = "pdf".into();
        let mut host = host_with("Foto/IMG_0001.CR3", b"RAW finto")
            .with_binary_document("Foto/IMG_0002.Cr3", b"RAW finto")
            .with_binary_document("Libri/manuale.pdf", b"%PDF-1.7")
            .with_binary_document("Lettere/lettera.DOCX", b"PK")
            .with_format("pdf", pdf_format);
        for (doc, subject, editor) in [
            ("Foto/IMG_0001.CR3", PreviewSubject::Raw, "LightCraft"),
            ("Foto/IMG_0002.Cr3", PreviewSubject::Raw, "LightCraft"),
            ("Libri/manuale.pdf", PreviewSubject::Pdf, "PdfCraft"),
            (
                "Lettere/lettera.DOCX",
                PreviewSubject::Document,
                "WordCraft",
            ),
        ] {
            let doc = DocId::new(doc);
            let out = preview(&mut host, &doc, PreviewSize::Small).unwrap();
            assert_eq!(out.info.app, subject, "{doc}");
            assert_eq!(out.info.editor, editor, "{doc}");
            assert_eq!(out.missing, Some(Missing::Absent), "{doc}");
            assert_eq!(out.origin, PreviewOrigin::None);
            assert!(out.image.is_none() && out.render.is_none() && out.limit_bytes.is_none());
            let revision = out.revision.as_ref().expect("la revisione di oggi");
            assert_eq!(
                host.writes_on(&cache_key(&revision.0, PreviewSize::Small))
                    .0,
                0
            );
        }
    }

    #[test]
    fn a_name_without_an_extension_has_no_subject() {
        for name in ["LEGGIMI", "Libri/.pdf", "Foto/IMG.cr", "Foto/IMG.xmp.bak"] {
            let mut host = MemoryHost::new().with_binary_document(name, b"x");
            let error = preview(&mut host, &DocId::new(name), PreviewSize::Small).unwrap_err();
            assert!(
                matches!(error, PluginError::BadArgs(_)),
                "{name}: {error:?}"
            );
        }
    }

    #[test]
    fn an_xmp_stays_an_xmp_from_its_format() {
        let mut host = host_with("Foto/IMG_0001.xmp", b"<x:xmpmeta/>");
        let out = preview(
            &mut host,
            &DocId::new("Foto/IMG_0001.xmp"),
            PreviewSize::Small,
        )
        .unwrap();
        assert_eq!(out.info.app, PreviewSubject::Xmp);
        assert_eq!(out.missing, Some(Missing::Absent));
    }

    #[test]
    fn a_broken_file_is_unreadable_and_a_huge_one_over_limit() {
        let mut host = host_with("rotto.pcraft", b"non sono uno zip");
        let out = preview(&mut host, &DocId::new("rotto.pcraft"), PreviewSize::Small).unwrap();
        assert_eq!(out.missing, Some(Missing::Unreadable));
        assert_eq!(out.limit_bytes, None);

        let huge = vec![b' '; MAX_FILE_BYTES + 1];
        let mut host = host_with("enorme.vectorcraft", &huge);
        let doc = DocId::new("enorme.vectorcraft");
        let reads = host.reads_on(doc.as_str()).0;
        let out = preview(&mut host, &doc, PreviewSize::Small).unwrap();
        assert_eq!(out.missing, Some(Missing::OverLimit));
        assert_eq!(out.limit_bytes, Some(MAX_FILE_BYTES as u64));
        assert_eq!(out.info.bytes, huge.len() as u64);
        assert_eq!(out.origin, PreviewOrigin::None);
        // Solo le due letture della revisione: i byte non si aprono.
        assert_eq!(host.reads_on(doc.as_str()).0, reads + 2);
    }

    #[test]
    fn a_document_that_is_not_craft_is_refused_with_a_key() {
        let mut host = MemoryHost::new().with_document("Nota.md", "# Nota\n");
        let error = preview(&mut host, &DocId::new("Nota.md"), PreviewSize::Small).unwrap_err();
        assert!(
            matches!(&error, PluginError::BadArgs(text)
                if text.as_message().is_some_and(|m| m.key == "not_craft")),
            "{error:?}"
        );
    }
}
