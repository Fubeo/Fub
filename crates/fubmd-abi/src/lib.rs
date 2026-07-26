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
//! - i **comandi** ([`command`]): un'azione descritta a una macchina — argomenti
//!   dichiarati, raggio dichiarato, e la simulazione come modo di invocarla;
//! - i trait di **import ed export** ([`transfer`]): come i dati entrano nel
//!   vault e come ne escono, a byte e non a path;
//! - la **modifica chirurgica** di un documento ([`edit`]): l'edit come coppia
//!   (span, testo) sopra la revisione su cui è stato calcolato;
//! - il protocollo di **UI dichiarativa** ([`ui`]) e gli **eventi** ([`event`]);
//! - il **contesto di sessione** ([`session`]): quale pannello ha il focus, che
//!   documento guarda, cosa c'è selezionato dentro.
//!
//! **Invariante:** nessuna dipendenza da markdown, tauri, wasmtime o tokio.
//! Definendo ogni trait una volta sola qui, l'impl nativa (diretta) e l'impl
//! WASM-proxy (M5) condividono la stessa firma e il kernel non distingue i due.

pub mod arena;
pub mod command;
pub mod edit;
pub mod error;
pub mod event;
pub mod format;
pub mod ipc;
pub mod model;
pub mod session;
pub mod traits;
pub mod transfer;
pub mod ui;

// Re-export dei tipi più usati, per import ergonomici.
pub use command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, InvokeMode, ParamKind, ParamSpec, PlannedEdit,
};
pub use edit::{AppliedEdit, EditReport, EditRequest, Revision, TextEdit};
pub use error::{FormatError, PluginError};
pub use event::{Event, EventKind, EventMask};
pub use format::{
    FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext, RenderOptions,
};
pub use model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, Inline, Link, LinkTarget, Span, Tag,
};
pub use session::{ContextKind, ContextMask, PaneId, PaneMode, Selection, ViewContext};
pub use traits::{
    BacklinkRef, CommandProvider, DocumentProperties, EventHandler, HealthCheck, HealthIssue,
    HostApi, IndexProvider, IndexQuery, IndexResult, LinkDirection, NeighborRef, Page, Paged,
    Plugin, PluginManifest, PropertyCount, PropertyEntry, PropertyFilter, PropertySort,
    PropertyTest, SearchHit, SearchScope, ViewProvider, ViewSpec,
};
pub use transfer::{
    ConflictPolicy, ExportArtifact, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportRequest,
    ImportSource, ImportedDocument, NoteLevel, TransferNote,
};
pub use ui::{ActionId, UiAction, UiNode, ViewUpdate};
