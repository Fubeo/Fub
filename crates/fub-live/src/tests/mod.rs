//! Le prove della sessione con un client in-process: l'host vero, su una rete
//! in memoria con il tempo in pausa, e una prova sul loopback TCP.
//!
//! Ogni caso di §7, §8 e §9 di `sessione-live.md` ha la sua prova: i file
//! seguono le sezioni della spec.

mod client;
mod host;
mod limits;
pub(crate) mod net;
mod pairing;
mod resume;
mod security;
mod support;
