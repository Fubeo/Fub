//! **Il secondo backend** (§16.1, [M5](../../../docs/project/m5-wasm-runtime.md)):
//! un componente WASM che il kernel vede come qualunque altro provider.
//!
//! Il contratto è congelato dal 2026-08-14 (`fub:abi@0.1.1`), e questo crate è
//! il primo consumatore che lo attraversa **in esecuzione**. Fino a qui il
//! confine era stato provato in due modi, tutt'e due statici:
//! `wit_conformance.rs` legge il WIT e dice che è valido,
//! `tools/varco-wasm` lo genera e lo compila lato guest e dice che si lascia
//! attraversare. Nessuno dei due ha mai *chiamato* niente.
//!
//! # La forma, in una riga
//!
//! Per ogni trait del contratto un tipo di qui lo implementa e reinoltra al
//! componente: `WasmPlugin` è un [`Plugin`], `WasmCommandProvider` è un
//! [`CommandProvider`](fub_abi::traits::CommandProvider). Il kernel riceve
//! `Box<dyn Trait>` e non ha un solo ramo che sappia dire quale dei due backend
//! ha in mano — è il «un trait, due backend» di
//! [`traits.md`](../../../docs/reference/abi-and-wit.md), e la prova che regge è
//! il test di parità: **lo stesso** ping del plugin nativo di M4, ricompilato a
//! componente, che risponde la stessa cosa.
//!
//! # Dove NON sta l'enforcement
//!
//! Non qui. Le capacità le applica il `Guard<H, P: Policy>` del kernel, che è
//! il punto unico dalla [0021](../../../docs/decisions/0185-capability-un-solo-guard.md) e
//! resta l'unico: le host function di questo crate ricevono un `&mut dyn
//! HostApi` **già incappucciato** dalla politica del plugin e si limitano a
//! passargli la chiamata. Un secondo punto in cui si decide chi può cosa
//! sarebbe un secondo punto in cui sbagliare, e il primo giorno in cui i due
//! divergono nessuno se ne accorge.

#![deny(missing_docs)]

mod borrow;
mod component;
mod events;
mod guest;
mod limits;
mod model;
mod translate;

pub use component::{Component, LoadError, WasmBundle, WasmCommandProvider, WasmPlugin};

/// I binding **lato host** di `plugin-world`, generati dal contratto.
///
/// Sono l'altra metà di `tools/varco-wasm`: quello genera il guest e lo
/// compila, questo genera l'host e lo esegue. La sorgente è la stessa —
/// `crates/fub-abi/wit/fub/abi.wit` — e deliberatamente non è la copia
/// congelata in `wit/frozen/0.1.1.wit`: la copia congelata è il **presidio**
/// della baseline (nessuno la tocca, e un `diff` dice se qualcuno l'ha fatto),
/// il file vivo è la **sorgente**. Un host generato dalla copia sarebbe un host
/// che non si accorge di una rottura del vivo, cioè il presidio girato dalla
/// parte sbagliata.
///
/// `trappable_imports` resta spento: una capacità che rifiuta risponde
/// `plugin-error`, che è un valore del contratto, e non un trap. La differenza
/// non è di stile — un trap abbatte l'istanza, e «non ti è concesso» non è una
/// ragione per abbattere niente.
// Il generato non si documenta: la documentazione del contratto sta nel WIT, e
// riscriverla qui sarebbe una seconda copia che diverge alla prima modifica.
#[allow(missing_docs)]
pub mod contract {
    wasmtime::component::bindgen!({
        path: "../fub-abi/wit/fub/abi.wit",
        world: "plugin-world",
    });
}
