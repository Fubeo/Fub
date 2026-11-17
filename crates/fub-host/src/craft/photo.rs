//! I dati di una foto: l'XMP che le sta accanto e ciò che dice, la risposta di `craft.photo`.
//!
//! È il contrario dell'anteprima di un XMP, che cerca la sua foto: qui si
//! parte dalla foto e si cercano i suoi XMP con [`xmp::sidecar_candidates`],
//! prima `IMG_0001.CR3.xmp` e poi `IMG_0001.xmp`, così come sono scritti.
//! L'anagrafe dice quali esistono, con una domanda sola per la cartella della
//! foto (a pagine): un XMP in un'altra cartella non conta, e una cartella che
//! si chiama come un candidato non è fra le voci. Il primo candidato che si
//! legge vince; un candidato che non si legge (sparito, negato) lascia il
//! posto al prossimo. Un XMP oltre [`MAX_XMP_BYTES`] non si legge affatto e
//! vale un XMP rotto: c'è, col suo nome, e `meta` è `None`. Il tetto vale
//! anche per un XMP cresciuto dopo l'anagrafe: con le lease del kernel
//! ([`Ranged`]) il peso viene dalla lease e oltre il tetto non si legge un
//! byte; senza, i byte dell'host più lunghi del tetto si scartano.
//!
//! Il comando non guarda se il documento è una foto: un file senza XMP
//! accanto risponde `xmp: None`. Un documento che è già un XMP non ha un XMP
//! suo, e nemmeno copie `-Edit.psd`. Fub non scrive niente: si leggono
//! l'anagrafe e i byte dell'XMP, nient'altro.

use fub_abi::model::DocId;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{FolderScope, HostApi, IndexQuery, IndexResult, Page, VaultEntry};
use fub_abi::PluginError;
use fub_format_craft::xmp::{self, MAX_XMP_BYTES};
use fub_format_craft::{CraftApp, PhotoSidecar, XmpInfo, PREVIEW_VERSION};

use super::ranged::{Ranged, RangedError};

/// Le voci di una cartella chieste all'anagrafe per volta.
const LISTING_PAGE: u32 = 500;
/// Quante volte si rilegge un XMP che cambia mentre lo si legge.
const ATTEMPTS: usize = 3;

/// L'XMP accanto a `doc`, ciò che dice e le copie `-Edit.psd` di `doc`.
/// Con `ranged` l'XMP si legge dalle lease del kernel; senza, o quando la
/// lease non si apre, dall'host.
///
/// Un documento che l'anagrafe non conosce è [`PluginError::NotFound`] con
/// la chiave `photo.missing` del catalogo del bundle; un vault chiuso è
/// l'errore dell'host.
pub fn photo(
    host: &dyn HostApi,
    ranged: Option<&Ranged>,
    doc: &DocId,
) -> Result<PhotoSidecar, PluginError> {
    let entries = folder_of(host, doc)?;
    let has = |id: &str| entries.iter().any(|entry| entry.id.as_str() == id);
    if !has(doc.as_str()) {
        return Err(PluginError::NotFound(Text::message(
            "photo.missing",
            vec![Arg::text("doc", doc.as_str())],
        )));
    }
    let mut answer = PhotoSidecar {
        version: PREVIEW_VERSION,
        doc: doc.as_str().to_string(),
        xmp: None,
        meta: None,
        edits: Vec::new(),
    };
    let is_xmp = host
        .format_of(doc)
        .and_then(|format| CraftApp::of_format(&format.descriptor.id))
        == Some(CraftApp::Xmp);
    if is_xmp {
        return Ok(answer);
    }
    for candidate in xmp::sidecar_candidates(doc.as_str()) {
        let Some(entry) = entries.iter().find(|entry| entry.id.as_str() == candidate) else {
            continue;
        };
        if entry.size > MAX_XMP_BYTES as u64 {
            answer.xmp = Some(candidate);
            break;
        }
        match read_xmp(host, ranged, &entry.id) {
            Ok(bytes) => {
                answer.meta = bytes
                    .and_then(|bytes| xmp::read(&bytes).ok())
                    .map(XmpInfo::from);
                answer.xmp = Some(candidate);
                break;
            }
            Err(error) => {
                tracing::debug!(%error, xmp = %candidate, "fub.craft: un XMP della foto non si legge, si passa al prossimo");
            }
        }
    }
    let edit = xmp::edit_copy_of(doc.as_str());
    if edit != doc.as_str() && has(&edit) {
        answer.edits.push(edit);
    }
    Ok(answer)
}

/// I byte dell'XMP `id`, al più [`MAX_XMP_BYTES`]: `None` quando è più
/// lungo. Dalla lease il peso si guarda prima di leggere; un file che cambia
/// fra due pezzi si rilegge, al più [`ATTEMPTS`] volte, poi risponde l'host.
fn read_xmp(
    host: &dyn HostApi,
    ranged: Option<&Ranged>,
    id: &DocId,
) -> Result<Option<Vec<u8>>, PluginError> {
    if let Some(ranged) = ranged {
        for _ in 0..ATTEMPTS {
            match ranged.read_all(id, MAX_XMP_BYTES as u64) {
                Ok(whole) => return Ok(Some(whole.bytes)),
                Err(RangedError::OverLimit { .. }) => return Ok(None),
                Err(RangedError::Stale) => continue,
                Err(RangedError::Kernel(_)) => break,
            }
        }
    }
    let bytes = host.read_document_bytes(id)?;
    Ok((bytes.len() <= MAX_XMP_BYTES).then_some(bytes))
}

/// I figli diretti della cartella di `doc`, come li conosce l'anagrafe, a
/// pagine. Le voci sono file: una cartella non c'è.
fn folder_of(host: &dyn HostApi, doc: &DocId) -> Result<Vec<VaultEntry>, PluginError> {
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
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_sdk::testing::MemoryHost;

    const XMP: &str = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="2"/></rdf:RDF></x:xmpmeta>"#;

    fn host_with(files: &[(&str, &[u8])]) -> MemoryHost {
        let mut host = MemoryHost::new();
        for (id, bytes) in files {
            host = host.with_binary_document(id, bytes);
        }
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
    fn the_whole_name_wins_over_the_stem() {
        let host = host_with(&[
            ("Foto/IMG.jpg", b"jpeg"),
            ("Foto/IMG.xmp", b"<rotto"),
            ("Foto/IMG.jpg.xmp", XMP.as_bytes()),
        ]);
        let out = photo(&host, None, &DocId::new("Foto/IMG.jpg")).unwrap();
        assert_eq!(out.xmp.as_deref(), Some("Foto/IMG.jpg.xmp"));
        assert_eq!(out.meta.and_then(|meta| meta.rating), Some(2));
        assert_eq!(out.version, PREVIEW_VERSION);
    }

    /// L'XMP che l'anagrafe conosce piccolo è cresciuto sul disco a
    /// `grown` byte prima della lettura.
    fn grown_xmp(grown: u64) -> (tempfile::TempDir, fub_kernel::Workspace, Ranged, MemoryHost) {
        let dir = tempfile::tempdir().unwrap();
        let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::write(root.join("IMG.jpg"), b"jpeg").unwrap();
        let file = std::fs::File::create(root.join("IMG.jpg.xmp")).unwrap();
        file.set_len(grown).unwrap();
        let ws = fub_kernel::Workspace::new(&root, fub_kernel::FormatRegistry::new()).unwrap();
        let ranged = Ranged::new(ws.resource_reader());
        let host = host_with(&[("IMG.jpg", b"jpeg"), ("IMG.jpg.xmp", XMP.as_bytes())]);
        (dir, ws, ranged, host)
    }

    #[test]
    fn an_xmp_grown_past_the_cap_is_not_read() {
        let (_dir, _ws, ranged, host) = grown_xmp(4 * MAX_XMP_BYTES as u64);
        let out = photo(&host, Some(&ranged), &DocId::new("IMG.jpg")).unwrap();
        assert_eq!(out.xmp.as_deref(), Some("IMG.jpg.xmp"));
        assert_eq!(out.meta, None);
        assert_eq!(ranged.bytes_read(), 0);
    }

    #[test]
    fn an_xmp_is_read_in_pieces_when_the_reader_is_there() {
        let (dir, _ws, ranged, host) = grown_xmp(0);
        std::fs::write(dir.path().join("IMG.jpg.xmp"), XMP).unwrap();
        let out = photo(&host, Some(&ranged), &DocId::new("IMG.jpg")).unwrap();
        assert_eq!(out.meta.and_then(|meta| meta.rating), Some(2));
        assert_eq!(ranged.bytes_read(), XMP.len() as u64);
    }

    #[test]
    fn an_xmp_has_no_xmp_and_a_missing_doc_is_not_found() {
        let host = host_with(&[("IMG.xmp", XMP.as_bytes()), ("IMG.xmp.xmp", XMP.as_bytes())]);
        let out = photo(&host, None, &DocId::new("IMG.xmp")).unwrap();
        assert_eq!((out.xmp, out.meta), (None, None));
        assert!(out.edits.is_empty());
        let error = photo(&host, None, &DocId::new("sparita.jpg")).unwrap_err();
        assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
    }
}
