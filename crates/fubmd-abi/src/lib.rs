//! # fubmd-abi — il contratto di FubMD
//!
//! Questo crate è l'unica fonte di verità del contratto tra il core agnostico
//! e i provider (nativi o, in futuro, plugin WASM di terzi):
//!
//! - il **modello di documento comune** ([`model`]), agnostico rispetto al formato;
//! - il trait centrale [`FormatProvider`](format::FormatProvider);
//! - gli altri **trait di estensione** ([`traits`]): comandi, view (UI dichiarativa),
//!   index (ricerca/backlink), event handler, ciclo di vita del plugin;
//! - il protocollo di **UI dichiarativa** ([`ui`]) e gli **eventi** ([`event`]).
//!
//! **Invariante:** nessuna dipendenza da markdown, tauri, wasmtime o tokio.
//! Definendo ogni trait una volta sola qui, l'impl nativa (diretta) e l'impl
//! WASM-proxy (M5) condividono la stessa firma e il kernel non distingue i due.

pub mod error;
pub mod event;
pub mod format;
pub mod model;
pub mod traits;
pub mod ui;

// Re-export dei tipi più usati, per import ergonomici.
pub use error::{FormatError, PluginError};
pub use event::{Event, EventKind, EventMask};
pub use format::{
    FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext, RenderOptions,
};
pub use model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, Inline, Link, LinkTarget, Span, Tag,
};
pub use traits::{
    BacklinkRef, CommandProvider, CommandSpec, EventHandler, HostApi, IndexProvider, IndexQuery,
    IndexResult, Plugin, PluginManifest, SearchHit, ViewProvider, ViewSpec,
};
pub use ui::{ActionId, UiAction, UiNode, ViewUpdate};
