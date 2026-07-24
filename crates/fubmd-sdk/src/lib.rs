//! # fubmd-sdk
//!
//! Helper per *implementare* i trait del contratto. Riesporta `fubmd-abi` così
//! che impl native e guest WASM importino da un unico posto.
//!
//! Per ora contiene [`scan`]: un toolkit di scansione testo condiviso da
//! qualsiasi provider testuale (estrazione di `#tag` e `[[wikilink]]`),
//! indipendente dal parser di formato.

pub use fubmd_abi as abi;

pub mod scan;
