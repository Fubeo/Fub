//! # fub-sdk
//!
//! Helper per *implementare* i trait del contratto. Riesporta `fub-abi` così
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
//!   ha bisogno è il guest;
//! - [`ui`]: i costruttori dell'albero che ogni `ViewProvider` ridisegna a mano
//!   — il segnaposto per il vuoto, la riga con azione e payload;
//! - [`testing`]: il **banco del lato provider** — un host in memoria e una
//!   suite di conformità con cui provare un provider contro il **contratto**
//!   invece che contro il kernel ([decisione
//!   0054](../../../docs/decisions/0196-test-e-artefatti-generati.md)).
//!
//! # Cosa questo crate non può avere
//!
//! `fub-kernel`, e nemmeno dietro una cargo feature. L'SDK è ciò che un guest
//! WASM importerà a M5, ed è **dipendenza normale** di
//! `fub-format-markdown`: il kernel qui dentro finirebbe nella libreria di un
//! provider, cioè esattamente dove il progetto ha deciso che non stia. Il banco
//! del lato *host* — costruire un vault vero, registrare, far girare un giro di
//! eventi — sta in `fub-testkit`, che è un altro crate per questa ragione
//! ([decisione 0055](../../../docs/decisions/0196-test-e-artefatti-generati.md)).
//! È presidiato da `fub-abi/tests/dependency_invariant.rs`.

pub use fub_abi as abi;

pub mod ids;
pub mod scan;
pub mod testing;
pub mod ui;
