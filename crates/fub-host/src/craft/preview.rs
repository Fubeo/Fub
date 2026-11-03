//! L'anteprima di un file Craft: il `CraftPreview` di un documento per una
//! misura.
//!
//! Prima la cache del bundle, poi il file. La voce in cache sta a
//! [`cache_key`] della revisione e della misura, e vale solo se si legge, è
//! della [`PREVIEW_VERSION`] e ripete lo stesso documento, la stessa revisione
//! e la stessa misura: una voce rotta, vecchia o di un altro file vale una voce
//! che non c'è. Altrimenti si leggono i byte, l'immagine che il file porta
//! (`container::embedded_preview`) e le informazioni (`read_meta`, e per un
//! XMP `xmp::read` con la foto e le copie `-Edit.psd` che gli stanno accanto).
//!
//! Si scrive in cache solo un'anteprima con l'immagine del file (`origin:
//! file`), e solo se la revisione non è cambiata mentre si leggeva: una
//! scrittura che non riesce, o che chi chiama non può fare, non toglie
//! l'anteprima. Un file oltre [`MAX_FILE_BYTES`] non si legge: è `origin:
//! none` col solo peso che l'anagrafe conosce.

use fub_abi::model::DocId;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{FolderScope, HostApi, IndexQuery, IndexResult, Page, VaultEntry};
use fub_abi::PluginError;
use fub_format_craft::container::MAX_FILE_BYTES;
use fub_format_craft::{
    cache_key, CraftApp, CraftPreview, PreviewInfo, PreviewOrigin, PreviewSize, PREVIEW_VERSION,
};

mod craft_files;
mod xmp;

/// Quante volte si rilegge un file che cambia mentre lo si legge.
const ATTEMPTS: usize = 3;
/// Le voci di una cartella chieste all'anagrafe per volta.
const LISTING_PAGE: u32 = 500;

/// L'anteprima di `doc` alla misura `size`.
///
/// Un documento che non è un file Craft è [`PluginError::BadArgs`] con la
/// chiave `not_craft` del catalogo del bundle; un documento che non c'è, o che
/// sparisce mentre lo si legge, è l'errore dell'host.
pub fn preview(
    host: &mut dyn HostApi,
    doc: &DocId,
    size: PreviewSize,
) -> Result<CraftPreview, PluginError> {
    let app = host
        .format_of(doc)
        .and_then(|format| CraftApp::of_format(&format.descriptor.id))
        .ok_or_else(|| {
            PluginError::BadArgs(Text::message(
                "not_craft",
                vec![Arg::text("doc", doc.as_str())],
            ))
        })?;
    let mut last = None;
    for _ in 0..ATTEMPTS {
        let revision = host.document_revision(doc)?;
        if let Some(cached) = cached(&*host, doc, &revision.0, size) {
            return Ok(cached);
        }
        let folder = Folder::read(&*host, doc)?;
        let declared = folder.size_of(doc);
        let preview = if declared.is_some_and(|bytes| bytes > MAX_FILE_BYTES as u64) {
            // D-8: un file troppo grande non si apre nemmeno.
            empty(doc, &revision, size, app, declared.unwrap_or_default())
        } else {
            let bytes = host.read_document_bytes(doc)?;
            read(doc, &revision, size, app, &bytes, &folder)
        };
        // La revisione si rilegge dopo i byte: se è cambiata, l'anteprima è di
        // un file che non c'è più e si rifà.
        if host.document_revision(doc)? != revision {
            last = Some(preview);
            continue;
        }
        if preview.origin == PreviewOrigin::File {
            if let Ok(bytes) = serde_json::to_vec(&preview) {
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

/// La voce in cache, se si legge, è di questa versione e ripete documento,
/// revisione e misura.
fn cached(
    host: &dyn HostApi,
    doc: &DocId,
    revision: &str,
    size: PreviewSize,
) -> Option<CraftPreview> {
    let bytes = host.cache_read(&cache_key(revision, size)).ok()??;
    let preview: CraftPreview = serde_json::from_slice(&bytes).ok()?;
    (preview.version == PREVIEW_VERSION
        && preview.doc == doc.as_str()
        && preview.revision.0 == revision
        && preview.size == size)
        .then_some(preview)
}

/// L'anteprima senza immagine, con ciò che si sa senza leggere il file.
fn empty(
    doc: &DocId,
    revision: &fub_abi::Revision,
    size: PreviewSize,
    app: CraftApp,
    bytes: u64,
) -> CraftPreview {
    CraftPreview {
        version: PREVIEW_VERSION,
        doc: doc.as_str().to_string(),
        revision: revision.clone(),
        size,
        origin: PreviewOrigin::None,
        queued: false,
        image: None,
        info: PreviewInfo {
            app,
            editor: app.editor_name().to_string(),
            format_version: None,
            bytes,
            photo: None,
            edits: Vec::new(),
            xmp: None,
        },
        render: None,
    }
}

/// L'anteprima dai byte del file.
fn read(
    doc: &DocId,
    revision: &fub_abi::Revision,
    size: PreviewSize,
    app: CraftApp,
    bytes: &[u8],
    folder: &Folder,
) -> CraftPreview {
    let mut preview = empty(doc, revision, size, app, bytes.len() as u64);
    if app == CraftApp::Xmp {
        xmp::read(&mut preview, doc, bytes, folder);
    } else {
        craft_files::read(&mut preview, app, bytes, size);
    }
    preview
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
        assert_eq!(first.info.format_version.as_deref(), Some("4"));
        let image = first.image.as_ref().unwrap();
        assert_eq!((image.width, image.height), (64, 32));
        let key = cache_key(&first.revision.0, PreviewSize::Small);
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
            |p: &mut CraftPreview| p.version = 2,
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
        let key = cache_key(&out.revision.0, PreviewSize::Small);
        assert_eq!(host.writes_on(&key).0, 0);
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
