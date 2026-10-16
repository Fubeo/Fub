//! Le prove della sessione con un client in-process: l'host vero, su una rete
//! in memoria con il tempo in pausa, e una prova sul loopback TCP.
//!
//! Ogni caso di «Ripresa», «Limiti del protocollo», «Codici di chiusura» e
//! «Modello di sicurezza» in `docs/reference/live-session.md` ha la sua prova:
//! i file seguono le sezioni della pagina.

mod client;
mod host;
mod limits;
pub(crate) mod net;
mod pairing;
mod resume;
mod security;
mod support;
