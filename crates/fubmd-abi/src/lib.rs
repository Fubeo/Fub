//! # fubmd-abi — il contratto di FubMD
//!
//! Questo crate è l'unica fonte di verità del contratto tra il core agnostico
//! e i provider (nativi o, in futuro, plugin WASM di terzi):
//!
//! - il **modello di documento comune** ([`model`]), agnostico rispetto al formato,
//!   e la sua forma **al confine** ([`arena`]: alberi appiattiti, span a
//!   larghezza fissa) — la conversione che il proxy WASM di M5 erediterà;
//! - il trait centrale [`format::FormatProvider`];
//! - gli altri **trait di estensione** ([`traits`]): comandi, view (UI dichiarativa),
//!   index (ricerca/backlink), event handler, ciclo di vita del plugin;
//! - il protocollo di **UI dichiarativa** ([`ui`]) e gli **eventi** ([`event`]).
//!
//! **Invariante:** nessuna dipendenza da markdown, tauri, wasmtime o tokio.
//! Definendo ogni trait una volta sola qui, l'impl nativa (diretta) e l'impl
//! WASM-proxy (M5) condividono la stessa firma e il kernel non distingue i due.

pub mod arena;
pub mod error;
pub mod event;
pub mod format;
pub mod ipc;
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
    BacklinkRef, CommandProvider, CommandSpec, DocumentMetadata, EventHandler, FullTextScope,
    GraphDirection, HealthCheckKind, HealthIssue, HostApi, IndexProvider, IndexQuery,
    IndexResult, NeighborRef, Pagination, PaginatedResult, Plugin, PluginManifest, PropertyValue,
    SearchHit, ViewProvider, ViewSpec,
};
pub use ui::{ActionId, UiAction, UiNode, ViewUpdate};
