//! Le prove della sessione con un client in-process: l'host vero, su una rete
//! in memoria con il tempo in pausa, e una prova sul loopback TCP.
//!
//! Ogni caso di §7, §8 e §9 di `sessione-live.md` ha la sua prova: i file
//! seguono le sezioni della spec.

pub(crate) mod net;
