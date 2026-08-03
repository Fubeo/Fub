//! # fub-features
//!
//! Feature ufficiali come codice nativo: implementano gli **stessi trait** che
//! useranno i plugin di terzi a M5, senza sandbox e senza serializzazione.
//!
//! - [`backlinks`] — il pannello backlink come
//!   [`ViewProvider`](fub_abi::traits::ViewProvider): si prende documento
//!   attivo e riferimenti dall'[`HostApi`](fub_abi::traits::HostApi), come un
//!   plugin (M2).
//! - [`outline`] — il pannello struttura come
//!   [`ViewProvider`](fub_abi::traits::ViewProvider): legge gli heading del
//!   documento attivo dal kernel via `IndexQuery::Outline` (M2).
//! - [`tags`] — il pannello tag come
//!   [`ViewProvider`](fub_abi::traits::ViewProvider): aggrega i tag del vault
//!   via `IndexQuery::Tags`, click→ricerca (M2).
//! - [`stats`] — il pannello statistiche come
//!   [`ViewProvider`](fub_abi::traits::ViewProvider): parole, caratteri,
//!   selezione e tempo di lettura dal **contesto di sessione** (M2, decisione 0007).
//! - [`trash`] — il cestino come
//!   [`ViewProvider`](fub_abi::traits::ViewProvider): elenca `list_trash` e
//!   agisce con i comandi `trash.restore` e `trash.empty` del registro, senza
//!   una capacità sua (§1.2).
//! - [`search`] — [`IndexProvider`](fub_abi::traits::IndexProvider) full-text
//!   su tantivy, persistente e incrementale (M2).
//! - [`commands`] — i comandi ufficiali come
//!   [`CommandProvider`](fub_abi::traits::CommandProvider): cerca, wikilink
//!   sulla selezione, sostituzione in blocco con anteprima del piano (decisione 0009,
//!   decisione 0010).
//! - [`blocks`] — le sintassi e i renderer ufficiali come
//!   [`SyntaxRule`](fub_abi::custom::SyntaxRule) e
//!   [`CustomRenderer`](fub_abi::custom::CustomRenderer): diagrammi, formule
//!   ed evidenziato entrano **senza toccare il provider markdown** (decisione 0017).
//! - [`versioning`] — snapshot per-file del vault come
//!   [`EventHandler`](fub_abi::traits::EventHandler): il dogfooding più
//!   completo del contratto, perché usa solo ciò che avrà un plugin di terzi.
//! - [`inventario`] — l'elenco delle feature qui sopra, e non una descrizione di
//!   esso: è da qui che `fub_host::mount` le monta, quindi una feature fuori
//!   dall'elenco semplicemente non c'è. Le view ne sono un sottoinsieme
//!   derivato, non una seconda tabella (§16.7).

#[cfg(feature = "backlinks")]
pub mod backlinks;
#[cfg(feature = "blocks")]
pub mod blocks;
#[cfg(feature = "commands")]
pub mod commands;
pub mod inventario;
#[cfg(feature = "outline")]
pub mod outline;
#[cfg(feature = "search")]
pub mod search;
#[cfg(feature = "stats")]
pub mod stats;
#[cfg(feature = "tags")]
pub mod tags;
#[cfg(feature = "trash")]
pub mod trash;
#[cfg(feature = "versioning")]
pub mod versioning;

#[cfg(feature = "backlinks")]
pub use backlinks::{build_backlinks_view, BacklinksView, BACKLINKS_ID, BACKLINKS_VIEW};
#[cfg(feature = "blocks")]
pub use blocks::{
    DiagramRenderer, DiagramRule, HighlightRule, MathRenderer, MathRule, BLOCKS_ID, DIAGRAMS_RULE,
    DIAGRAM_NS, DIAGRAM_RENDERER, HIGHLIGHT_RULE, MATH_RENDERER, MATH_RULE,
};
#[cfg(feature = "commands")]
pub use commands::{
    occurrences, CoreCommands, COMMANDS_ID, NOTE_CREATE, NOTE_RENAME, NOTE_TASK_TOGGLE, NOTE_TRASH,
    SEARCH_OPEN, SELECTION_WIKILINK, SETTINGS_EXPORT, SETTINGS_IMPORT, SETTINGS_NS, SETTINGS_RESET,
    SETTINGS_SET, TRASH_EMPTY, TRASH_RESTORE, VAULT_ARCHIVE, VAULT_REPLACE, VAULT_UNDO,
};
pub use inventario::{ogni_feature_ufficiale, ogni_view_ufficiale, FeatureUfficiale};
#[cfg(feature = "outline")]
pub use outline::{build_outline_view, OutlineView, OUTLINE_ID, OUTLINE_VIEW};
#[cfg(feature = "search")]
pub use search::{SearchIndex, SEARCH_ID};
#[cfg(feature = "stats")]
pub use stats::{
    build_stats_view, count, reading_minutes, StatsView, TextStats, STATS_ID, STATS_VIEW,
};
#[cfg(feature = "tags")]
pub use tags::{build_tags_view, TagPanelView, TAGS_ID, TAGS_VIEW};
#[cfg(feature = "trash")]
pub use trash::{TrashView, TRASH_ID, TRASH_VIEW};
#[cfg(feature = "versioning")]
pub use versioning::{VersionRef, VersionStore, VersioningHandler, VERSIONING_ID};
