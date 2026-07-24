//! # fubmd-features
//!
//! Feature ufficiali come codice nativo. Per M1: costruzione della UI
//! dichiarativa del pannello **backlink** a partire dai riferimenti calcolati
//! dal grafo del kernel. Ricerca full-text (tantivy) e graph view arrivano a M2.

pub mod backlinks;

pub use backlinks::build_backlinks_view;
