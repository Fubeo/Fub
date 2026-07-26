//! # fubmd-features
//!
//! Feature ufficiali come codice nativo: implementano gli **stessi trait** che
//! useranno i plugin di terzi a M5, senza sandbox e senza serializzazione.
//!
//! - [`backlinks`] — il pannello backlink come
//!   [`ViewProvider`](fubmd_abi::traits::ViewProvider): si prende documento
//!   attivo e riferimenti dall'[`HostApi`](fubmd_abi::traits::HostApi), come un
//!   plugin (M2).
//! - [`outline`] — il pannello struttura come
//!   [`ViewProvider`](fubmd_abi::traits::ViewProvider): legge gli heading del
//!   documento attivo dal kernel via `IndexQuery::Outline` (M2).
//! - [`tags`] — il pannello tag come
//!   [`ViewProvider`](fubmd_abi::traits::ViewProvider): aggrega i tag del vault
//!   via `IndexQuery::Tags`, click→ricerca (M2).
//! - [`stats`] — il pannello statistiche come
//!   [`ViewProvider`](fubmd_abi::traits::ViewProvider): parole, caratteri,
//!   selezione e tempo di lettura dal **contesto di sessione** (M2, §1.9).
//! - [`search`] — [`IndexProvider`](fubmd_abi::traits::IndexProvider) full-text
//!   su tantivy, persistente e incrementale (M2).
//! - [`versioning`] — snapshot per-file del vault come
//!   [`EventHandler`](fubmd_abi::traits::EventHandler): il dogfooding più
//!   completo del contratto, perché usa solo ciò che avrà un plugin di terzi.

pub mod backlinks;
pub mod outline;
pub mod search;
pub mod stats;
pub mod tags;
pub mod versioning;

/// Doppio dell'host per i test unitari delle feature (in memoria, orologio
/// pilotabile): una feature scritta come la scriverebbe un plugin si prova
/// contro il **contratto**, non contro il kernel.
#[cfg(test)]
mod testing;

pub use backlinks::{build_backlinks_view, BacklinksView, BACKLINKS_ID, BACKLINKS_VIEW};
pub use outline::{build_outline_view, OutlineView, OUTLINE_ID, OUTLINE_VIEW};
pub use search::{SearchIndex, SEARCH_ID};
pub use stats::{
    build_stats_view, count, reading_minutes, StatsView, TextStats, STATS_ID, STATS_VIEW,
};
pub use tags::{build_tags_view, TagPanelView, TAGS_ID, TAGS_VIEW};
pub use versioning::{VersionRef, VersionStore, VersioningHandler, VERSIONING_ID};
