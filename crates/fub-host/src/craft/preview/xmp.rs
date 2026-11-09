//! L'anteprima di un XMP: voto, etichetta e parole chiave (`xmp::read`), la
//! foto a cui appartiene e le copie `-Edit.psd` che le stanno accanto.

use fub_abi::model::DocId;
use fub_format_craft::xmp::{self, PhotoMatch};
use fub_format_craft::{CraftPreview, XmpInfo};

use super::Folder;

/// Completa `preview` coi byte dell'XMP e la cartella che lo contiene.
pub(super) fn read(preview: &mut CraftPreview, doc: &DocId, bytes: &[u8], folder: &Folder) {
    // Un XMP rotto resta un XMP: senza voto né parole chiave.
    preview.info.xmp = xmp::read(bytes).ok().map(XmpInfo::from);
    preview.info.photo = folder.photo_of(doc);
    if let Some(photo) = &preview.info.photo {
        let edit = xmp::edit_copy_of(photo);
        if folder.has(&edit) {
            preview.info.edits.push(edit);
        }
    }
}

impl Folder {
    /// La foto a cui l'XMP appartiene, se c'è: il nome esatto, o il primo file
    /// in ordine di id con lo stesso gambo e un'estensione diversa da quella
    /// dell'XMP. I nomi si confrontano come sono scritti.
    pub(super) fn photo_of(&self, doc: &DocId) -> Option<String> {
        let name = doc.as_str();
        let own_ext = name.rsplit_once('.').map_or("", |(_, ext)| ext);
        match xmp::photo_candidates(name) {
            PhotoMatch::Exact(photo) => self.has(&photo).then_some(photo),
            PhotoMatch::Stem(stem) if stem.is_empty() => None,
            PhotoMatch::Stem(stem) => self
                .entries
                .iter()
                .map(|entry| entry.id.as_str())
                .find(|id| {
                    id.strip_prefix(stem.as_str())
                        .and_then(|rest| rest.strip_prefix('.'))
                        .is_some_and(|ext| {
                            !ext.is_empty() && !ext.contains(['.', '/']) && ext != own_ext
                        })
                })
                .map(str::to_string),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::VaultEntry;

    #[test]
    fn the_photo_is_found_by_stem_in_id_order_and_as_written() {
        let folder = |ids: &[&str]| Folder {
            entries: ids
                .iter()
                .map(|id| VaultEntry {
                    id: DocId::new(*id),
                    kind: fub_abi::traits::EntryKind::Asset,
                    size: 1,
                    mtime: 0,
                    fingerprint: None,
                })
                .collect(),
        };
        let doc = DocId::new("Foto/IMG_0001.xmp");
        let found = folder(&[
            "Foto/IMG_0001.CR3",
            "Foto/IMG_0001.jpg",
            "Foto/IMG_0001.xmp",
        ]);
        assert_eq!(found.photo_of(&doc).as_deref(), Some("Foto/IMG_0001.CR3"));
        assert_eq!(folder(&["Foto/img_0001.CR3"]).photo_of(&doc), None);
        assert_eq!(folder(&["Foto/IMG_0001.xmp"]).photo_of(&doc), None);
        let exact = DocId::new("Foto/IMG_0001.CR3.xmp");
        assert_eq!(found.photo_of(&exact).as_deref(), Some("Foto/IMG_0001.CR3"));
        assert_eq!(folder(&["Foto/IMG_0001.cr3"]).photo_of(&exact), None);
    }
}
