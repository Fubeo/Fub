//! # fubmd-features
//!
//! Feature ufficiali come codice nativo: implementano gli **stessi trait** che
//! useranno i plugin di terzi a M5, senza sandbox e senza serializzazione.
//!
//! - [`backlinks`] — UI dichiarativa del pannello backlink, dai riferimenti
//!   calcolati dal grafo del kernel (M1).
//! - [`search`] — [`IndexProvider`](fubmd_abi::traits::IndexProvider) full-text
//!   su tantivy, persistente e incrementale (M2).
//! - [`versioning`] — snapshot per-file del vault come
//!   [`EventHandler`](fubmd_abi::traits::EventHandler): il dogfooding più
//!   completo del contratto, perché usa solo ciò che avrà un plugin di terzi.

pub mod backlinks;
pub mod search;
pub mod versioning;

pub use backlinks::build_backlinks_view;
pub use search::SearchIndex;
pub use versioning::{VersionRef, VersionStore, VersioningHandler};
