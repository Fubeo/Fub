//! # fub-live — la sessione live di FubDraw (ADR 0204)
//!
//! Un tablet scrive su un disegno aperto sul PC: il PC fa da host, il tablet
//! da scrittore. Il protocollo, versione 1, è descritto nella pagina di
//! riferimento `docs/reference/live-session.md` di Fub: messaggi JSON in
//! frame di testo su un WebSocket dentro TLS 1.3, sulla rete locale. Le
//! sezioni citate fra «» nei moduli sono quelle della pagina.
//!
//! Il crate non dipende da `fub-abi`, `fub-kernel`, `fub-host` né da Tauri, e
//! la prova `dependency_invariant` di `fub-abi` lo controlla. Non tocca il
//! documento: i commit arrivano alla shell come testo controllato solo nella
//! forma, e la shell li valida come le operazioni locali. Lo compone
//! `fub-app` sul runtime di Tauri, che è lo stesso `tokio`.
//!
//! # Moduli
//!
//! - [`protocol`]: i messaggi, i codici di chiusura e la lettura
//!   a strati, che non alloca più di quanto il limite precedente ha ammesso.
//! - [`counter`] e [`token`]: i contatori (`u64` come stringhe decimali) e i
//!   valori casuali della sessione, con i segreti a tempo costante.
//! - [`pairing`]: il testo del QR dei percorsi B e C e il suo disegno in SVG.
//! - [`net`]: l'indirizzo IPv4 privato su cui si ascolta, e i candidati con
//!   quello della rotta predefinita per primo.
//! - [`limits`]: i limiti del protocollo e quelli che l'host si dà da solo.
//! - [`host`]: il listener sul PC e l'API per la shell (FD-303): avvio,
//!   eventi, `send`, `status` con i commit in attesa, `stop`.
//! - [`client`]: lo scrittore in Rust dei percorsi B e C, con la ripresa e i
//!   commit rimandati oltre `lastC`.
//! - [`clock`]: lo scarto fra gli orologi dello scrittore e del PC.
//!
//! # Il modello di sicurezza
//!
//! - **Chi ascolta il Wi-Fi** vede solo TLS 1.3. **Chi si mette in mezzo**
//!   non ha il certificato effimero della sessione, e il client confronta la
//!   sua impronta SHA-256 con quella del QR prima di mandare un byte suo.
//! - **Un dispositivo estraneo** non conosce il segreto di 128 bit del QR,
//!   monouso e valido 5 minuti; dopo l'ingresso vale solo il gettone di
//!   ripresa, che cambia a ogni riconnessione.
//! - **L'esaurimento delle risorse** trova un limite su ogni misura che
//!   cresce con ciò che manda lo scrittore: byte prima del `hello`, handshake
//!   contemporanei, messaggi al secondo, commit in attesa, coda verso uno
//!   scrittore che non legge. Lo scrittore è uno solo, e il listener vive solo
//!   con la sessione, su un solo indirizzo privato.
//! - **Il canale verso la shell non è autorevole** (ADR 0184): un commit resta
//!   nell'host finché la shell non risponde, e `status` lo restituisce.
//!
//! Il percorso A, il client web con la CA locale, non è in questo crate.

#![forbid(unsafe_code)]

pub mod client;
pub mod clock;
pub mod counter;
pub mod host;
pub mod limits;
pub mod net;
pub mod pairing;
pub mod protocol;
mod rate;
mod tls;
pub mod token;

#[cfg(test)]
mod tests;
