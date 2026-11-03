//! Il contratto dell'anteprima di un file Craft, `CraftPreview`: la forma che
//! il bundle `fub.craft` risponde al comando [`PREVIEW_COMMAND`] e al job
//! [`RENDER_JOB`], che scrive nella sua cache, e che la shell e l'MCP leggono.
//! Accanto, [`PhotoSidecar`]: l'XMP di una foto, la risposta di
//! [`PHOTO_COMMAND`].
//!
//! La gemella TypeScript è `apps/client/src/host/craft.ts`; la fixture
//! `apps/client/src/__fixtures__/craft-preview.json`, scritta da
//! `tests/ts_preview.rs`, le tiene uguali.

use base64::Engine as _;
use fub_abi::Revision;
use serde::{Deserialize, Serialize};

use crate::apps::CraftApp;
use crate::container::png_size;
use crate::jpeg;
use crate::xmp::{Flag, PhotoMeta};

/// La versione della forma. Una risposta, o una voce della cache, di un'altra
/// versione non si legge.
pub const PREVIEW_VERSION: u32 = 2;
/// Il comando, in sola lettura, che chiede l'anteprima di un documento.
pub const PREVIEW_COMMAND: &str = "craft.preview";
/// Il job che fa l'anteprima con la riga di comando dell'app.
pub const RENDER_JOB: &str = "craft.render";
/// Il comando, in sola lettura, che chiede l'XMP di una foto.
pub const PHOTO_COMMAND: &str = "craft.photo";
/// Lo spazio dei nomi del bundle, e dell'effetto `Custom` del comando.
pub const BUNDLE_NS: &str = "fub.craft";
/// Il tipo di un'immagine PNG.
pub const PNG_MEDIA_TYPE: &str = "image/png";
/// Il tipo di un'immagine JPEG.
pub const JPEG_MEDIA_TYPE: &str = "image/jpeg";

/// L'anteprima di un documento Craft, per una misura e una revisione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CraftPreview {
    /// Sempre [`PREVIEW_VERSION`].
    pub version: u32,
    /// Il documento, come id del vault.
    pub doc: String,
    /// La revisione dei byte da cui l'anteprima è nata, o `None` quando si
    /// sono letti solo dei pezzi del file: senza tutti i byte non se ne sa
    /// l'impronta. Una risposta senza revisione non va in cache.
    pub revision: Option<Revision>,
    pub size: PreviewSize,
    pub origin: PreviewOrigin,
    /// La risposta ha messo in coda il job [`RENDER_JOB`].
    pub queued: bool,
    pub image: Option<PreviewImage>,
    /// Perché `image` manca; `None` quando c'è.
    pub missing: Option<Missing>,
    /// Il peso massimo in byte, solo con [`Missing::OverLimit`].
    pub limit_bytes: Option<u64>,
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

/// Perché l'anteprima non ha un'immagine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Missing {
    /// Il file non ne ha una.
    Absent,
    /// Andrebbe letto intero e supera il peso massimo (`limit_bytes`).
    OverLimit,
    /// Il file è rotto o non è del formato che dice.
    Unreadable,
    /// L'app ha provato per questa revisione e non ci è riuscita.
    Failed,
}

impl Missing {
    /// I quattro motivi, nell'ordine del contratto.
    pub const ALL: [Missing; 4] = [
        Missing::Absent,
        Missing::OverLimit,
        Missing::Unreadable,
        Missing::Failed,
    ];
}

/// L'immagine dell'anteprima, in base64, con le misure della sua intestazione
/// e l'orientamento da applicarle.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewImage {
    /// [`PNG_MEDIA_TYPE`] o [`JPEG_MEDIA_TYPE`].
    pub media_type: String,
    /// I byte dell'immagine in base64 standard, con il riempimento.
    pub data: String,
    /// Le misure dell'immagine (l'`IHDR` del PNG, il `SOF` del JPEG), non del
    /// file che la contiene.
    pub width: u32,
    pub height: u32,
    /// L'orientamento EXIF da 1 a 8 che chi mostra applica; 1 vuol dire
    /// «così com'è».
    pub orientation: u8,
}

impl PreviewImage {
    /// L'immagine di un PNG: la firma e le misure si prendono da
    /// [`png_size`], e senza misure lecite non c'è immagine. Un PNG si mostra
    /// così com'è.
    pub fn from_png(bytes: &[u8]) -> Option<PreviewImage> {
        let (width, height) = png_size(bytes)?;
        Some(PreviewImage {
            media_type: PNG_MEDIA_TYPE.to_owned(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            width,
            height,
            orientation: 1,
        })
    }

    /// L'immagine di un JPEG con l'orientamento `orientation`: le misure si
    /// prendono da [`jpeg::size`]. Senza misure lecite, o con un orientamento
    /// fuori da 1–8, non c'è immagine: chi legge l'orientamento da un file
    /// decide prima che cosa vale uno sbagliato.
    pub fn from_jpeg(bytes: &[u8], orientation: u8) -> Option<PreviewImage> {
        if !(1..=8).contains(&orientation) {
            return None;
        }
        let (width, height) = jpeg::size(bytes)?;
        Some(PreviewImage {
            media_type: JPEG_MEDIA_TYPE.to_owned(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            width,
            height,
            orientation,
        })
    }
}

/// Di che cosa è l'anteprima: le quattro famiglie dei provider Craft
/// ([`CraftApp`]) e i file che un'app Craft sa mostrare senza che Fub ne abbia
/// il provider (le foto RAW, i PDF, i documenti).
///
/// In JSON (`info.app`) è il suo [`id`](Self::id).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewSubject {
    #[serde(rename = "vectorcraft")]
    VectorCraft,
    #[serde(rename = "photocraft")]
    PhotoCraft,
    #[serde(rename = "figcraft")]
    FigCraft,
    Xmp,
    /// Una foto RAW, che LightCraft sviluppa.
    Raw,
    /// Un PDF, che PdfCraft apre.
    Pdf,
    /// Un documento di testo, che WordCraft apre.
    Document,
}

/// Le estensioni delle foto RAW, senza il punto.
const RAW_EXTENSIONS: [&str; 8] = ["cr3", "cr2", "nef", "arw", "raf", "dng", "orf", "rw2"];
/// Le estensioni dei PDF.
const PDF_EXTENSIONS: [&str; 1] = ["pdf"];
/// Le estensioni dei documenti di testo.
const DOCUMENT_EXTENSIONS: [&str; 4] = ["docx", "odt", "rtf", "doc"];

impl PreviewSubject {
    /// I sette soggetti, nell'ordine del contratto.
    pub const ALL: [PreviewSubject; 7] = [
        PreviewSubject::VectorCraft,
        PreviewSubject::PhotoCraft,
        PreviewSubject::FigCraft,
        PreviewSubject::Xmp,
        PreviewSubject::Raw,
        PreviewSubject::Pdf,
        PreviewSubject::Document,
    ];

    /// Il nome del soggetto nel contratto: lo stesso che serde scrive.
    pub fn id(self) -> &'static str {
        match self {
            PreviewSubject::VectorCraft => "vectorcraft",
            PreviewSubject::PhotoCraft => "photocraft",
            PreviewSubject::FigCraft => "figcraft",
            PreviewSubject::Xmp => "xmp",
            PreviewSubject::Raw => "raw",
            PreviewSubject::Pdf => "pdf",
            PreviewSubject::Document => "document",
        }
    }

    /// L'id dell'app Craft che sa farne l'anteprima, fra quelle che Fub
    /// conosce; un XMP non ha un'immagine da fare.
    pub fn editor(self) -> Option<&'static str> {
        match self {
            PreviewSubject::VectorCraft => Some("vectorcraft"),
            PreviewSubject::PhotoCraft => Some("photocraft"),
            PreviewSubject::FigCraft => Some("figcraft"),
            PreviewSubject::Xmp => None,
            PreviewSubject::Raw => Some("lightcraft"),
            PreviewSubject::Pdf => Some("pdfcraft"),
            PreviewSubject::Document => Some("wordcraft"),
        }
    }

    /// Il nome da mostrare dell'editor esterno che apre il file
    /// (`info.editor`): un XMP è di LightCraft, che lo scrive accanto alla
    /// foto.
    pub fn editor_name(self) -> &'static str {
        match self {
            PreviewSubject::VectorCraft => "VectorCraft",
            PreviewSubject::PhotoCraft => "PhotoCraft",
            PreviewSubject::FigCraft => "FigCraft",
            PreviewSubject::Xmp | PreviewSubject::Raw => "LightCraft",
            PreviewSubject::Pdf => "PdfCraft",
            PreviewSubject::Document => "WordCraft",
        }
    }

    /// Il soggetto di un file dalla sua estensione `ext`, senza il punto,
    /// soltanto per i tre che non hanno un provider Craft: una foto RAW, un
    /// PDF, un documento. Le quattro famiglie dei provider vengono dal
    /// formato. L'estensione si confronta senza badare al maiuscolo ASCII
    /// (`IMG_0001.CR3`).
    pub fn of_extension(ext: &str) -> Option<PreviewSubject> {
        [
            (PreviewSubject::Raw, &RAW_EXTENSIONS[..]),
            (PreviewSubject::Pdf, &PDF_EXTENSIONS[..]),
            (PreviewSubject::Document, &DOCUMENT_EXTENSIONS[..]),
        ]
        .into_iter()
        .find(|(_, known)| known.iter().any(|known| known.eq_ignore_ascii_case(ext)))
        .map(|(subject, _)| subject)
    }
}

impl From<CraftApp> for PreviewSubject {
    fn from(app: CraftApp) -> Self {
        match app {
            CraftApp::VectorCraft => PreviewSubject::VectorCraft,
            CraftApp::PhotoCraft => PreviewSubject::PhotoCraft,
            CraftApp::FigCraft => PreviewSubject::FigCraft,
            CraftApp::Xmp => PreviewSubject::Xmp,
        }
    }
}

/// Ciò che si sa del file, con o senza immagine.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewInfo {
    pub app: PreviewSubject,
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
/// comparire la domanda o il pulsante «Crea l'anteprima con …».
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderOffer {
    /// Il nome da mostrare dell'app.
    pub app: String,
    /// Il valore dell'impostazione delle anteprime fatte dalle app: la shell
    /// sceglie da qui fra la domanda, il pulsante e la riga «spente».
    pub consent: RenderConsent,
}

/// Se Fub può far fare un'anteprima all'app esterna.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderConsent {
    /// Lo chiede a chi guarda.
    Ask,
    /// Sì, senza chiedere.
    On,
    /// No.
    Off,
}

impl RenderConsent {
    /// I tre valori, nell'ordine del contratto.
    pub const ALL: [RenderConsent; 3] = [RenderConsent::Ask, RenderConsent::On, RenderConsent::Off];
}

/// L'XMP che sta accanto a una foto e i suoi dati: la risposta di
/// [`PHOTO_COMMAND`], in sola lettura.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhotoSidecar {
    /// Sempre [`PREVIEW_VERSION`].
    pub version: u32,
    /// La foto, come id del vault.
    pub doc: String,
    /// L'XMP della foto, se c'è nel vault.
    pub xmp: Option<String>,
    /// Ciò che l'XMP dice della foto; `None` senza XMP o con uno che non si
    /// legge.
    pub meta: Option<XmpInfo>,
    /// Le copie `-Edit.psd` della foto che esistono.
    pub edits: Vec<String>,
}

/// Il percorso nella cache del bundle dell'anteprima di `revision` alla misura
/// `size`: `previews/{:016x}.json`, con l'FNV-1a a 64 bit di
/// `"{revision}\0{size}"`, come le schede dei link. La voce ripete `doc` e
/// `revision`, e una che non corrisponde, o di un'altra
/// [`PREVIEW_VERSION`], vale assente.
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

    /// Un JPEG minimo: `SOI`, un `SOF0` di `width`×`height`, `EOI`.
    fn jpeg(width: u16, height: u16) -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x0B, 8];
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&[1, 1, 0x11, 0]);
        out.extend_from_slice(&[0xFF, 0xD9]);
        out
    }

    #[test]
    fn un_jpeg_porta_le_sue_misure_e_un_orientamento_lecito() {
        let image = PreviewImage::from_jpeg(&jpeg(1620, 1080), 6).unwrap();
        assert_eq!(image.media_type, JPEG_MEDIA_TYPE);
        assert_eq!(
            (image.width, image.height, image.orientation),
            (1620, 1080, 6)
        );
        assert_eq!(PreviewImage::from_jpeg(&jpeg(2, 2), 0), None);
        assert_eq!(PreviewImage::from_jpeg(&jpeg(2, 2), 9), None);
        assert_eq!(PreviewImage::from_jpeg(b"\x89PNG", 1), None);
    }

    #[test]
    fn i_soggetti_nuovi_vengono_dall_estensione_senza_badare_al_maiuscolo() {
        for ext in ["cr3", "CR3", "Cr3", "nef", "DNG", "rw2"] {
            assert_eq!(
                PreviewSubject::of_extension(ext),
                Some(PreviewSubject::Raw),
                "{ext}"
            );
        }
        assert_eq!(
            PreviewSubject::of_extension("PDF"),
            Some(PreviewSubject::Pdf)
        );
        for ext in ["docx", "odt", "RTF", "doc"] {
            assert_eq!(
                PreviewSubject::of_extension(ext),
                Some(PreviewSubject::Document),
                "{ext}"
            );
        }
        // Le famiglie dei provider vengono dal formato, non da qui.
        for ext in [
            "",
            "xmp",
            "vectorcraft",
            "pcraft",
            "figcraft",
            "jpg",
            "cr",
            "cr33",
        ] {
            assert_eq!(PreviewSubject::of_extension(ext), None, "{ext}");
        }
    }

    #[test]
    fn ogni_soggetto_ha_il_suo_id_e_la_sua_app() {
        for subject in PreviewSubject::ALL {
            let json = serde_json::to_value(subject).unwrap();
            assert_eq!(json, subject.id());
        }
        for app in CraftApp::ALL {
            let subject = PreviewSubject::from(app);
            assert_eq!(subject.id(), app.id());
            assert_eq!(subject.editor_name(), app.editor_name());
        }
        assert_eq!(PreviewSubject::Xmp.editor(), None);
        assert_eq!(PreviewSubject::Raw.editor(), Some("lightcraft"));
        assert_eq!(PreviewSubject::Pdf.editor(), Some("pdfcraft"));
        assert_eq!(PreviewSubject::Document.editor(), Some("wordcraft"));
        assert_eq!(PreviewSubject::VectorCraft.editor(), Some("vectorcraft"));
    }
}
