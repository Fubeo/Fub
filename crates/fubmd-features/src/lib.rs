//! # fubmd-features
//!
//! Feature ufficiali come codice nativo: implementano gli **stessi trait** che
//! useranno i plugin di terzi a M5, senza sandbox e senza serializzazione.
//!
//! - [`backlinks`] — UI dichiarativa del pannello backlink, dai riferimenti
//!   calcolati dal grafo del kernel (M1).
//! - [`search`] — [`IndexProvider`](fubmd_abi::traits::IndexProvider) full-text
//!   su tantivy, persistente e incrementale (M2).

pub mod backlinks;
pub mod search;

pub use backlinks::build_backlinks_view;
pub use search::SearchIndex;
