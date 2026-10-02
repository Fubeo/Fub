//! # fub-live — la sessione live di FubDraw (ADR 0204)
//!
//! Un tablet scrive su un disegno aperto sul PC: il PC fa da host, il tablet
//! da scrittore. Il protocollo è quello di `sessione-live.md` (versione 1):
//! messaggi JSON in frame di testo su un WebSocket dentro TLS 1.3, sulla rete
//! locale.

#![forbid(unsafe_code)]

pub mod clock;
pub mod counter;
pub mod limits;
pub mod protocol;
pub mod token;
