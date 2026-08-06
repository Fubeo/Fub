//! # fub-kernel — il core agnostico di Fub
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
//! - [`SettingsStore`] — *com'è configurato questo vault* (§11.1): gli schemi
//!   che i plugin dichiarano nel manifest, i due livelli di valori (vault e
//!   macchina) e la precedenza fra loro;
//! - [`Workspace`] — l'orchestratore che li mette insieme.
//!
//! # I cinque proprietari (§8.1)
//!
//! `Workspace` non è un `struct` con ventiquattro campi piatti: ne ha
//! **cinque**, e ognuno ha un nome che dice di cosa risponde —
//! [`DocumentStore`] (il disco, e come ciò che ci sta sopra diventa un
//! modello), `Indexes` (il canale dati),
//! `ProviderRegistry` (chi è registrato e cosa ha dichiarato),
//! [`Dispatcher`] (quando un evento parte, con che nome e per quanto) e
//! [`Session`] (cosa sta guardando l'utente adesso).
//!
//! Il taglio passa fra **decidere e chiamare**, non fra sottosistemi: ogni
//! chiamata a un provider vuole un `HostApi`, che è costruito su tutto il
//! workspace, quindi `render_view`, `invoke_command`, `import`, `export` e il
//! drenaggio della coda restano orchestrazione **sul `Workspace`**, e nei
//! componenti c'è ciò a cui si risponde *senza svegliare nessuno*. È anche la
//! linea lungo cui il §8.3 ha messo il `RwLock`: chi legge prende il prestito
//! condiviso, chi chiama un provider quello esclusivo. Vedi la
//! [decisione 0022](../../../docs/decisions/0022-il-kernel-a-pezzi.md) e la
//! [0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md).
//!
//! **Invariante:** questo crate non dipende da comrak/pulldown, wasmtime o
//! tauri. Se `comrak` comparisse nel suo albero delle dipendenze, il design
//! sarebbe fallito.
//!
//! **Le regole non sono qui.** Come si confrontano due proprietà, quando un
//! path relativo diventa un `DocId`, cosa conta come link rotto, quale tag sta
//! sotto quale: stanno in [`fub_abi::rules`], perché sono la risposta a
//! domande del **contratto** e chi le serve può non avere questo crate fra le
//! mani. Il kernel le usa da lì come chiunque altro.

pub mod bus;
pub mod dispatcher;
mod docdata;
pub mod documents;
pub mod drafts;
mod entries;
pub mod error;
pub mod graph;
mod health;
pub mod host;
pub mod ignore;
pub mod index;
pub mod journal;
pub mod locale;
pub mod log;
pub mod maintenance;
mod occurrences;
pub mod organization;
pub mod plugins;
pub mod properties;
mod providers;
pub mod random;
pub mod registry;
pub mod renderer;
pub mod safety;
pub mod session;
pub mod settings;
pub mod storage;
pub mod syntax;
mod tag_counts;
pub mod time;
pub mod transfer;
mod undo;
pub mod vault;
pub mod viewstate;
pub mod workspace;

pub use bus::{EventBus, Subscription};
pub use dispatcher::{Dispatcher, JobBell, PendingJob};
pub use documents::DocumentStore;
pub use error::{KernelError, Result};
pub use graph::LinkGraph;
pub use host::{Capability, CapabilitySet, Granted, Guard, Policy, ReadOnly};
pub use index::plan::{PlanStep, QueryPlan};
pub use index::{RouteConflict, CORE_ID};
pub use journal::{journal_path, JournalOp, JournalRecord, Lettura};
pub use locale::SystemLocale;
pub use organization::{organization_path, OrganizationStore};
pub use plugins::{PluginInfo, PluginRegistry, Registration, RegistrationKind, RegistryError};
pub use registry::{FormatRegistry, RegistryConflict};
pub use renderer::{RenderedDocument, RenderedPart, RendererConflict, RendererRegistry};
pub use session::Session;
pub use settings::{MachineSettings, SettingsStore, SharedSettings};
pub use storage::{update_atomic, write_atomic};
pub use storage::{DirEntry, EntryKind, FsStorage, MemStorage, Stat, VaultStorage};
pub use syntax::{SyntaxConflict, SyntaxRegistry};
pub use vault::{data_root, TrashEntry, Vault, FUB_DIR, TRASH_DIR};
pub use viewstate::ViewStates;
pub use workspace::{
    new_doc_id, valid_doc_id, Apertura, GraphUpdate, Indicizzazione, ParsedBatch, ParsedChange,
    Scarto, Trust, Workspace, INDEX_JOB, MAIN_PANE,
};
