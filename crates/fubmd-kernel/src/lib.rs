//! # fubmd-kernel — il core agnostico di FubMD
//!
//! Orchestrazione del vault senza sapere nulla di alcun formato concreto:
//!
//! - [`Vault`] — cartella di documenti sul filesystem, mappatura path ⇆ `DocId`;
//! - [`LinkGraph`] — risoluzione dei link (wikilink stile Obsidian e link
//!   markdown a path relativi) e backlink;
//! - [`FormatRegistry`] — selezione del `dyn FormatProvider` per estensione;
//! - [`SyntaxRegistry`] e [`RendererRegistry`] — *chi disegna ciò che il core
//!   non conosce*: la sintassi innestata su un provider che non la conosce, e il
//!   renderer registrato per un `custom_kind`;
//! - [`EventBus`] — pub/sub degli eventi del vault;
//! - [`Workspace`] — l'orchestratore che li mette insieme.
//!
//! **Invariante:** questo crate non dipende da comrak/pulldown, wasmtime o
//! tauri. Se `comrak` comparisse nel suo albero delle dipendenze, il design
//! sarebbe fallito.
//!
//! **Le regole non sono qui.** Come si confrontano due proprietà, quando un
//! path relativo diventa un `DocId`, cosa conta come link rotto, quale tag sta
//! sotto quale: stanno in [`fubmd_abi::rules`], perché sono la risposta a
//! domande del **contratto** e chi le serve può non avere questo crate fra le
//! mani. Il kernel le usa da lì come chiunque altro.

pub mod bus;
pub mod error;
pub mod graph;
mod health;
pub mod host;
pub mod index;
pub mod plugins;
mod providers;
pub mod registry;
pub mod renderer;
pub mod syntax;
mod tag_counts;
pub mod time;
pub mod vault;
pub mod workspace;

pub use bus::EventBus;
pub use error::{KernelError, Result};
pub use graph::LinkGraph;
pub use host::{Capability, CapabilitySet, Granted, Guard, Policy, ReadOnly};
pub use index::plan::{PlanStep, QueryPlan};
pub use index::{RouteConflict, CORE_ID};
pub use plugins::{PluginInfo, PluginRegistry, Registration, RegistrationKind, RegistryError};
pub use registry::{FormatRegistry, RegistryConflict};
pub use renderer::{RenderedDocument, RenderedPart, RendererConflict, RendererRegistry};
pub use syntax::{SyntaxConflict, SyntaxRegistry};
pub use vault::{TrashEntry, Vault, TRASH_DIR};
pub use workspace::{valid_doc_id, GraphUpdate, Trust, Workspace, MAIN_PANE};
