//! # fub-abi — il contratto di Fub
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
pub mod net;
pub mod options;
pub mod organization;
pub mod query;
pub mod rules;
pub mod schema;
pub mod session;
pub mod settings;
pub mod text;
pub mod traits;
pub mod transfer;
pub mod ui;

// **Ogni tipo pubblico del contratto si vede da qui.** Non è un elenco dei
// "tipi più usati" — quella formula lasciava decidere a chi scriveva, e chi
// scriveva decideva per omissione: un tipo nuovo nasceva raggiungibile solo per
// il path lungo, che passa dal modulo di implementazione in cui è dichiarato.
// L'elenco è presidiato da `tests/superficie_della_radice.rs`, che lo confronta
// coi tipi `pub` letti dai sorgenti: chi ne aggiunge uno e non lo mette qui
// trova rosso, e chi lo toglie pure. Gli unici moduli che restano qualificati
// sono quelli dichiarati là dentro, con la ragione per cui lo sono.
pub use command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo, UndoStep,
    Undone,
};
pub use custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxForm, SyntaxMatch,
    SyntaxProduct, SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
pub use edit::{AppliedEdit, EditReport, EditRequest, Revision, TextEdit, WriteBase};
pub use error::{FormatError, PluginError};
pub use event::{
    Actor, BatchId, DocChange, DocChanges, Event, EventKind, EventMask, Notice, Origin, Severity,
    Subject,
};
pub use format::{
    DocumentFormat, DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider,
    ParseContext, RenderOptions, RenderTarget, SourceKind,
};
pub use locale::{HourCycle, Locale, Weekday};
pub use model::{
    Anchor, Block, ColumnAlign, DateFormats, DateOrder, DocId, DocumentModel, Frontmatter, Heading,
    HeadingSlugs, Inline, Link, LinkTarget, ListItem, ParsedWikilink, PropertyDate, PropertyScalar,
    PropertyTime, PropertyValue, Span, TableCell, TableRow, Tag, TaskMarker,
};
pub use net::{HttpHeader, HttpMethod, HttpRequest, HttpResponse};
pub use options::{OptionMap, OptionStatus};
pub use organization::Organization;
pub use query::{
    Matches, QueryClause, QueryEvaluator, QueryExpr, QueryLiteral, QueryPredicate, TextField,
    TextMode, TextQuery, TextTolerance,
};
pub use schema::SchemaVersion;
pub use session::{
    AnchoredSelection, AnchoredSelections, ContextKind, ContextMask, FloatingSelection,
    FloatingSelections, PaneId, PaneMode, SelectionSet, ViewContext,
};
pub use settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
pub use text::{Arg, ArgValue, Localize, Message, StringCatalog, Strings, Text};
pub use traits::{
    BacklinkRef, CivilTime, CommandProvider, DataRead, DataWrite, DocPosition, DocumentMatch,
    DraftInfo, EntryKind, EventHandler, Excerpts, FolderScope, HealthCheck, HealthIssue, HostApi,
    HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery, HostServices, IndexLoss,
    IndexProvider, IndexQuery, IndexResult, IndexingState, JobId, JobProgress, JobSpec, JobStatus,
    LinkDirection, NeighborRef, Page, Paged, Plugin, PluginManifest, PluginPermissions,
    PredicateKind, PropertyCount, PropertyEntry, PropertyFilter, PropertySelect, PropertySort,
    PropertyTest, QueryKind, QueryRoute, ReadApi, ResolvedRef, ServiceProvider, SettingsRead,
    SettingsWrite, TagCount, TimerSchedule, TimerSpec, TransferRead, TrashEntry, VaultEntry,
    VaultFolder, VaultRead, VaultStatus, VaultStructure, VaultWrite, ViewInstance, ViewInterests,
    ViewProvider, ViewSpec, ViewStateRead, ViewStateWrite, ViewSurface, WallClock,
    MAX_RANDOM_BYTES,
};
pub use transfer::{
    ArtifactContent, ArtifactHandle, ArtifactSink, ConflictPolicy, ExportArtifact, ExportProvider,
    ExportReport, ExportRequest, ExportSelection, ExportTarget, ImportMode, ImportOutcome,
    ImportProvider, ImportReport, ImportRequest, ImportSource, ImportedDocument, NoteLevel,
    SourceContent, SourceHandle, StreamedSource, TransferNote,
};
pub use ui::{
    ActionId, ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction,
    UiKind, UiNode, UiOption, UiValue, ViewUpdate,
};
