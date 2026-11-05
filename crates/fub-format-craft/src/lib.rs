//! I file delle app Craft nel vault, in sola lettura: i disegni di VectorCraft
//! (`.vectorcraft`), le immagini a livelli di PhotoCraft (`.pcraft`), i
//! progetti di FigCraft (`.figcraft`) e gli XMP che LightCraft scrive accanto
//! alle foto (`.xmp`).
//!
//! Il crate legge tre cose, e nient'altro:
//!
//! - i **metadati**: il titolo, la versione del formato, il testo per la
//!   ricerca e, per un XMP, voto, etichetta, scelta e parole chiave;
//! - i **file collegati**: un file piazzato in un documento è un suo link;
//! - l'**anteprima** che il file porta, nella forma del contratto
//!   [`CraftPreview`](contract::CraftPreview).
//!
//! Non usa mai il motore di un'app e non scrive mai un file: i contenitori si
//! aprono con un tetto a ogni lettura ([`container`]), e `serialize` rifiuta.
//! L'anteprima che il file non porta la fa l'app esterna, avviata dall'host.

pub mod apps;
pub mod container;
pub mod contract;
pub mod jpeg;
pub mod linked;
pub mod office;
pub mod provider;
pub mod raw;
pub mod xmp;

pub use apps::{
    CraftApp, FIGCRAFT_FORMAT_ID, PHOTOCRAFT_FORMAT_ID, VECTORCRAFT_FORMAT_ID, XMP_FORMAT_ID,
};
pub use contract::{
    cache_key, CraftPreview, Missing, PhotoSidecar, PreviewImage, PreviewInfo, PreviewOrigin,
    PreviewSize, PreviewSubject, RenderConsent, RenderOffer, XmpInfo, BUNDLE_NS, JPEG_MEDIA_TYPE,
    PHOTO_COMMAND, PNG_MEDIA_TYPE, PREVIEW_COMMAND, PREVIEW_VERSION, RENDER_JOB,
};
pub use provider::{providers, CraftProvider};
