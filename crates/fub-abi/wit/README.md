# crates/fub-abi/wit/

Il contratto WIT di Fub descrive `fub-abi` nel linguaggio dei componenti WebAssembly.

Vive dentro `fub-abi` perché tipi Rust, WIT e test di conformità devono cambiare insieme.

- Contratto vivo: [`fub/abi.wit`](fub/abi.wit)
- Baseline congelate: [`frozen/`](frozen/)
- Conformità Rust ↔ WIT: [`wit_conformance.rs`](../tests/wit_conformance.rs)
- Additività: [`wit_additivity.rs`](../tests/wit_additivity.rs)

La spiegazione canonica del versionamento, del freeze e dei limiti del runtime è in [`docs/reference/wit-contract.md`](../../../docs/reference/wit-contract.md).
