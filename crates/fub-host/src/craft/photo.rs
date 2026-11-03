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
//! vale un XMP rotto: c'è, col suo nome, e `meta` è `None`.
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

/// Le voci di una cartella chieste all'anagrafe per volta.
const LISTING_PAGE: u32 = 500;

/// L'XMP accanto a `doc`, ciò che dice e le copie `-Edit.psd` di `doc`.
///
/// Un documento che l'anagrafe non conosce è [`PluginError::NotFound`] con
/// la chiave `photo.missing` del catalogo del bundle; un vault chiuso è
/// l'errore dell'host.
pub fn photo(host: &dyn HostApi, doc: &DocId) -> Result<PhotoSidecar, PluginError> {
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
        match host.read_document_bytes(&entry.id) {
            Ok(bytes) => {
                answer.meta = xmp::read(&bytes).ok().map(XmpInfo::from);
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
        let out = photo(&host, &DocId::new("Foto/IMG.jpg")).unwrap();
        assert_eq!(out.xmp.as_deref(), Some("Foto/IMG.jpg.xmp"));
        assert_eq!(out.meta.and_then(|meta| meta.rating), Some(2));
        assert_eq!(out.version, PREVIEW_VERSION);
    }

    #[test]
    fn an_xmp_has_no_xmp_and_a_missing_doc_is_not_found() {
        let host = host_with(&[("IMG.xmp", XMP.as_bytes()), ("IMG.xmp.xmp", XMP.as_bytes())]);
        let out = photo(&host, &DocId::new("IMG.xmp")).unwrap();
        assert_eq!((out.xmp, out.meta), (None, None));
        assert!(out.edits.is_empty());
        let error = photo(&host, &DocId::new("sparita.jpg")).unwrap_err();
        assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
    }
}
