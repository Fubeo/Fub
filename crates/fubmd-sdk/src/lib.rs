//! # fubmd-sdk
//!
//! Helper per *implementare* i trait del contratto. Riesporta `fubmd-abi` così
//! che impl native e guest WASM importino da un unico posto.
//!
//! Contiene:
//!
//! - [`scan`]: un toolkit di scansione testo condiviso da qualsiasi provider
//!   testuale (estrazione di `#tag` e `[[wikilink]]`), indipendente dal parser
//!   di formato;
//! - [`ids`]: le **forme** di un'identità — UUID v4 e v7, id corti — costruite
//!   sopra l'entropia che l'host concede (§12.3). Il contratto dà i byte, che
//!   solo l'host ha; disporli è codice di libreria, e sta qui perché a M5 chi ne
//!   ha bisogno è il guest.

pub use fubmd_abi as abi;

pub mod ids;
pub mod scan;
