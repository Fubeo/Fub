//! # fubmd-kernel — il core agnostico di FubMD
//!
//! Orchestrazione del vault senza sapere nulla di alcun formato concreto:
//!
//! - [`Vault`] — cartella di documenti sul filesystem, mappatura path ⇆ `DocId`;
//! - [`LinkGraph`] — risoluzione wikilink (stile Obsidian) e backlink;
//! - [`FormatRegistry`] — selezione del `dyn FormatProvider` per estensione;
//! - [`EventBus`] — pub/sub degli eventi del vault;
//! - [`Workspace`] — l'orchestratore che li mette insieme.
//!
//! **Invariante:** questo crate non dipende da comrak/pulldown, wasmtime o
//! tauri. Se `comrak` comparisse nel suo albero delle dipendenze, il design
//! sarebbe fallito.

pub mod bus;
pub mod error;
pub mod graph;
pub mod registry;
pub mod time;
pub mod vault;
pub mod workspace;

pub use bus::EventBus;
pub use error::{KernelError, Result};
pub use graph::LinkGraph;
pub use registry::FormatRegistry;
pub use vault::{TrashEntry, Vault, TRASH_DIR};
pub use workspace::{GraphUpdate, Workspace};
