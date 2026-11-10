//! Gli **altri trait di estensione**, definiti una volta sola qui nel contratto.
//! Le feature ufficiali (backlink, ricerca, graph) li implementano in modo
//! nativo; i plugin di terzi (M5) li implementeranno via proxy WASM. Il kernel
//! vede sempre `dyn Trait` e non sa quale backend c'è dietro.
//!
//! Nota M1: la superficie è definita per intero (è il valore del crate-contratto),
//! ma l'app M1 cabla solo ciò che serve — backlink e ricerca passano per
//! `IndexProvider`/il grafo del kernel.

use serde::{Deserialize, Serialize};

use crate::command::{CommandOutcome, CommandSpec, InvokeMode, ParamSpec, PlannedEdit, Undone};
use crate::custom::SyntaxForm;
use crate::edit::{EditReport, EditRequest, Revision, WriteBase};
use crate::error::PluginError;
use crate::event::{Event, EventMask, Notice};
use crate::format::{DocumentFormat, LinkInsert};
use crate::locale::{Locale, Weekday};
use crate::model::{
    DocId, DocumentModel, Heading, LinkTarget, PropertyScalar, PropertyValue, Span, TaskMarker,
};
use crate::organization::Organization;
use crate::query::{QueryExpr, QueryPredicate};
use crate::render::{EmbedContent, RenderedDocument};
use crate::session::{ContextMask, ViewContext};
use crate::settings::{SettingEntry, SettingSpec, SettingValue};
use crate::text::{Localize, StringCatalog, Text};
use crate::transfer::{
    ExportReport, ExportRequest, ExportTarget, ImportReport, ImportRequest, ImportSource,
};
use crate::ui::{UiAction, UiNode, ViewUpdate};

mod host;
mod index;
mod index_provider;
mod job;
mod plugin;
mod query;
mod stores;
mod vault;
mod views;

pub use host::{
    HostApi, HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery, HostServices, ReadApi,
    ServiceProvider, TransferRead, MAX_RANDOM_BYTES,
};
pub use index::{
    DocPosition, DocumentMatch, DraftInfo, Excerpts, HealthCheck, HealthIssue, LinkDirection, Page,
    Paged, PropertyCount, PropertyEntry, PropertyFilter, PropertySelect, PropertySort,
    PropertyTest, ResolvedRef,
};
pub use index_provider::{
    BacklinkRef, IndexLoss, IndexProvider, IndexResult, IndexingState, NeighborRef, TagCount,
    VaultStatus,
};
pub use job::{JobId, JobProgress, JobSpec, JobStatus};
pub use plugin::{
    abi_compatible, CivilTime, ComponentKind, Delivery, EventHandler, Plugin, PluginManifest,
    PluginPermissions, TimerSchedule, TimerSpec, WallClock, ABI_VERSION,
};
pub use query::{IndexQuery, PredicateKind, QueryKind, QueryRoute};
pub use stores::{
    DataRead, DataWrite, SettingsRead, SettingsWrite, VaultRead, VaultStructure, VaultWrite,
    ViewStateRead, ViewStateWrite,
};
pub use vault::{EntryKind, FolderScope, TrashEntry, VaultEntry, VaultFolder};
pub use views::{
    CommandProvider, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};

#[cfg(test)]
mod tests;
