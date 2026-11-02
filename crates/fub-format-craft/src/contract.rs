//! Il contratto dell'anteprima di un file Craft, `CraftPreview`: la forma che
//! il bundle `fub.craft` risponde al comando [`PREVIEW_COMMAND`] e al job
//! [`RENDER_JOB`], che scrive nella sua cache, e che la shell e l'MCP leggono.
//!
//! La gemella TypeScript è `apps/client/src/host/craft.ts`; la fixture
//! `apps/client/src/__fixtures__/craft-preview.json`, scritta da
//! `tests/ts_preview.rs`, le tiene uguali.

use base64::Engine as _;
use fub_abi::Revision;
use serde::{Deserialize, Serialize};

use crate::apps::CraftApp;
use crate::container::png_size;
use crate::xmp::{Flag, PhotoMeta};

/// La versione della forma. Una risposta, o una voce della cache, di un'altra
/// versione non si legge.
pub const PREVIEW_VERSION: u32 = 1;
/// Il comando, in sola lettura, che chiede l'anteprima di un documento.
pub const PREVIEW_COMMAND: &str = "craft.preview";
/// Il job che fa l'anteprima con la riga di comando dell'app.
pub const RENDER_JOB: &str = "craft.render";
/// Lo spazio dei nomi del bundle, e dell'effetto `Custom` del comando.
pub const BUNDLE_NS: &str = "fub.craft";
/// Il tipo dell'immagine: l'anteprima è sempre un PNG.
pub const PNG_MEDIA_TYPE: &str = "image/png";

/// L'anteprima di un documento Craft, per una misura e una revisione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CraftPreview {
    /// Sempre [`PREVIEW_VERSION`].
    pub version: u32,
    /// Il documento, come id del vault.
    pub doc: String,
    /// La revisione dei byte da cui l'anteprima è nata.
    pub revision: Revision,
    pub size: PreviewSize,
    pub origin: PreviewOrigin,
    /// La risposta ha messo in coda il job [`RENDER_JOB`].
    pub queued: bool,
    pub image: Option<PreviewImage>,
    pub info: PreviewInfo,
    /// L'app che può fare l'anteprima che manca, se è installata.
    pub render: Option<RenderOffer>,
}

/// La misura chiesta: `small` per la figura nella nota e l'anteprima al
/// passaggio, `large` per la scheda.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewSize {
    Small,
    Large,
}

impl PreviewSize {
    /// Il nome della misura nel contratto, lo stesso che serde scrive.
    pub fn as_str(self) -> &'static str {
        match self {
            PreviewSize::Small => "small",
            PreviewSize::Large => "large",
        }
    }
}

/// Da dove viene l'immagine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewOrigin {
    /// L'anteprima era nel file.
    File,
    /// L'ha fatta la riga di comando dell'app.
    Cli,
    /// Non c'è.
    None,
}

/// Il PNG dell'anteprima, in base64, con le misure della sua intestazione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewImage {
    /// Sempre [`PNG_MEDIA_TYPE`].
    pub media_type: String,
    /// I byte del PNG in base64 standard, con il riempimento.
    pub data: String,
    pub width: u32,
    pub height: u32,
}

impl PreviewImage {
    /// L'immagine di un PNG: la firma e le misure si prendono da
    /// [`png_size`], e senza misure lecite non c'è immagine.
    pub fn from_png(bytes: &[u8]) -> Option<PreviewImage> {
        let (width, height) = png_size(bytes)?;
        Some(PreviewImage {
            media_type: PNG_MEDIA_TYPE.to_owned(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            width,
            height,
        })
    }
}

/// Ciò che si sa del file, con o senza immagine.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewInfo {
    pub app: CraftApp,
    /// Il nome da mostrare dell'editor esterno.
    pub editor: String,
    /// La versione del formato scritta nel file.
    pub format_version: Option<String>,
    /// Il peso del file.
    pub bytes: u64,
    /// Per un XMP, la foto a cui appartiene, se c'è nel vault.
    pub photo: Option<String>,
    /// Le copie `-Edit.psd` della foto che esistono.
    pub edits: Vec<String>,
    /// Per un XMP, ciò che dice della foto.
    pub xmp: Option<XmpInfo>,
}

/// Voto, etichetta, scelta e parole chiave di un XMP.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct XmpInfo {
    pub rating: Option<i8>,
    pub label: Option<String>,
    pub flag: Option<Flag>,
    pub keywords: Vec<String>,
}

impl From<PhotoMeta> for XmpInfo {
    fn from(meta: PhotoMeta) -> Self {
        XmpInfo {
            rating: meta.rating,
            label: meta.label,
            flag: meta.flag,
            keywords: meta.keywords,
        }
    }
}

/// L'app installata che può fare l'anteprima che manca: è ciò che fa
/// comparire il pulsante «Crea l'anteprima con …».
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderOffer {
    /// Il nome da mostrare dell'app.
    pub app: String,
}

/// Il percorso nella cache del bundle dell'anteprima di `revision` alla misura
/// `size`: `previews/{:016x}.json`, con l'FNV-1a a 64 bit di
/// `"{revision}\0{size}"`, come le schede dei link. La voce ripete `doc` e
/// `revision`, e una che non corrisponde vale assente.
pub fn cache_key(revision: &str, size: PreviewSize) -> String {
    let mut hash = fub_abi::Fnv1a::new();
    hash.update(revision.as_bytes());
    hash.update(b"\0");
    hash.update(size.as_str().as_bytes());
    format!("previews/{:016x}.json", hash.value())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_chiave_è_l_fnv_di_revisione_e_misura() {
        let key = cache_key("abc", PreviewSize::Small);
        assert_eq!(
            key,
            format!("previews/{:016x}.json", fub_abi::Fnv1a::hash(b"abc\0small"))
        );
        assert_ne!(key, cache_key("abc", PreviewSize::Large));
        assert_ne!(key, cache_key("abd", PreviewSize::Small));
        assert_eq!(key.len(), "previews/".len() + 16 + ".json".len());
    }

    #[test]
    fn un_png_senza_misure_non_è_un_immagine() {
        assert_eq!(PreviewImage::from_png(&[]), None);
        assert_eq!(PreviewImage::from_png(b"\xff\xd8\xff\xe0JFIF"), None);
    }
}
