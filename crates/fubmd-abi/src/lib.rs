//! # fubmd-abi — il contratto di FubMD
//!
//! Questo crate è l'unica fonte di verità del contratto tra il core agnostico
//! e i provider (nativi o, in futuro, plugin WASM di terzi):
//!
//! - il **modello di documento comune** ([`model`]), agnostico rispetto al formato,
//!   e la sua forma **al confine** ([`arena`]: alberi appiattiti, span a
//!   larghezza fissa) — la conversione che il proxy WASM di M5 erediterà;
//! - il trait centrale [`format::FormatProvider`], e i due innesti con cui **ciò
//!   che il core non conosce** entra lo stesso ([`custom`]): chi aggiunge la
//!   sintassi e chi disegna il blocco che ne esce;
//! - la mappa con namespace ([`options`]) con cui si dichiara *cosa è acceso, e
//!   con quale parametro* — la forma che sostituisce i booleani là dove la
//!   domanda ha una coda aperta;
//! - gli altri **trait di estensione** ([`traits`]): comandi, view (UI dichiarativa),
//!   index (ricerca/backlink), event handler, ciclo di vita del plugin;
//! - il **linguaggio delle interrogazioni** ([`query`]): quali documenti, detto
//!   con un albero di predicati invece che con una stringa nella sintassi di una
//!   dipendenza — e chi valuta cosa, dichiarato invece che scoperto per
//!   tentativi;
//! - i **comandi** ([`command`]): un'azione descritta a una macchina — argomenti
//!   dichiarati, raggio dichiarato, e la simulazione come modo di invocarla;
//! - i trait di **import ed export** ([`transfer`]): come i dati entrano nel
//!   vault e come ne escono, a byte e non a path;
//! - la **modifica chirurgica** di un documento ([`edit`]): l'edit come coppia
//!   (span, testo) sopra la revisione su cui è stato calcolato;
//! - il protocollo di **UI dichiarativa** ([`ui`]) e gli **eventi** ([`event`]):
//!   cosa è successo, **chi lo ha chiesto** e di quale **lotto** fa parte;
//! - il **contesto di sessione** ([`session`]): quale pannello ha il focus, che
//!   documento guarda, cosa c'è selezionato dentro;
//! - il **locale** ([`locale`]): in che lingua legge chi guarda, in che fuso
//!   vive, con che calendario — il fatto dell'host senza il quale un orologio
//!   sa dire *quando*, e non sa dirlo a nessuno;
//! - le **impostazioni** ([`settings`]): cosa un componente dichiara di poter
//!   configurare, su quale livello quel valore ha il diritto di stare, e quali
//!   chiavi un programma può scrivere;
//! - le **regole** ([`rules`]): la parte di una risposta che non dipende da chi
//!   la dà — come si confrontano due proprietà, quando un path relativo diventa
//!   un `DocId`, cosa conta come link rotto. Stanno qui e non nel kernel perché
//!   chi serve una `IndexQuery` può non avere il kernel fra le mani.
//!
//! **Invariante:** nessuna dipendenza da markdown, tauri, wasmtime o tokio.
//! Definendo ogni trait una volta sola qui, l'impl nativa (diretta) e l'impl
//! WASM-proxy (M5) condividono la stessa firma e il kernel non distingue i due.

pub mod arena;
pub mod command;
pub mod custom;
pub mod edit;
pub mod error;
pub mod event;
pub mod format;
pub mod ipc;
pub mod locale;
pub mod model;
pub mod options;
pub mod organization;
pub mod query;
pub mod rules;
pub mod session;
pub mod settings;
pub mod text;
pub mod traits;
pub mod transfer;
pub mod ui;

// Re-export dei tipi più usati, per import ergonomici.
pub use command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, InvokeMode, ParamKind, ParamSpec, PlannedEdit,
};
pub use custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
pub use edit::{AppliedEdit, EditReport, EditRequest, Revision, TextEdit};
pub use error::{FormatError, PluginError};
pub use event::{Actor, BatchId, Event, EventKind, EventMask, Notice, Origin, Subject};
pub use format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions, RenderTarget, SourceKind,
};
pub use locale::{HourCycle, Locale, Weekday};
pub use model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, Inline, Link, LinkTarget, Span, Tag,
};
pub use options::OptionMap;
pub use query::{
    Matches, QueryClause, QueryEvaluator, QueryExpr, QueryLiteral, QueryPredicate, TextField,
    TextMode, TextQuery,
};
pub use session::{ContextKind, ContextMask, PaneId, PaneMode, Selection, ViewContext};
pub use settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
pub use text::{Arg, ArgValue, Localize, Message, StringCatalog, Strings, Text};
pub use traits::{
    BacklinkRef, CommandProvider, DataRead, DataWrite, DocumentMatch, EventHandler, HealthCheck,
    HealthIssue, HostApi, HostCommands, HostEnv, HostEvents, HostQuery, HostServices,
    IndexProvider, IndexQuery, IndexResult, LinkDirection, NeighborRef, Page, Paged, Plugin,
    PluginManifest, PredicateKind, PropertyCount, PropertyEntry, PropertyFilter, PropertySelect,
    PropertySort, PropertyTest, QueryKind, QueryRoute, ReadApi, ServiceProvider, SettingsRead,
    SettingsWrite, TrashEntry, VaultRead, VaultStructure, VaultWrite, ViewInstance, ViewProvider,
    ViewSpec, ViewStateRead, ViewStateWrite, ViewSurface, MAX_RANDOM_BYTES,
};
pub use transfer::{
    ConflictPolicy, ExportArtifact, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportRequest,
    ImportSource, ImportedDocument, NoteLevel, TransferNote,
};
pub use ui::{
    ActionId, ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction,
    UiKind, UiNode, UiOption, UiValue, ViewUpdate,
};
