# crates/fubmd-abi/wit/

Il contratto **WIT** di FubMD, cioè `fubmd-abi` scritto una seconda volta nella
lingua dei componenti WASM.

Sta dentro `fubmd-abi` e non alla radice del repo perché è il **gemello di
questo crate**: descrive i suoi tipi, cambia quando cambiano loro, e i due test
che lo verificano — [`wit_conformance.rs`](../tests/wit_conformance.rs) e
[`wit_additivity.rs`](../tests/wit_additivity.rs) — vivono qui accanto. Finché
stava in radice quei test risalivano due livelli fuori dal proprio crate per
leggere un file che era comunque loro.

- Il contratto vivo: [`fubmd/abi.wit`](fubmd/abi.wit) — package `fubmd:abi@0.1.0`.
- Il contratto **com'era**, versione per versione: [`frozen/`](frozen/).

**La documentazione sta in `docs/`**, e non qui:

- perché questo albero esiste, cosa presidia e come si aggiorna →
  [docs/architecture/wit.md](../../../docs/architecture/wit.md);
- la linea di base congelata e la promessa di additività →
  [docs/architecture/wit-congelato.md](../../../docs/architecture/wit-congelato.md).
