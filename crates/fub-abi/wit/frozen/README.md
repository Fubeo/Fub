# crates/fub-abi/wit/frozen/

A copy of the contract for every **published** version, with the file name
matching the version (`0.1.0.wit` ↔ `package fub:abi@0.1.0`).

It is not an archive: it is the baseline against which
[`wit_additivity.rs`](../../tests/wit_additivity.rs) verifies the promise on
which M4's freeze rests — post-freeze the contract grows only by addition.

**The rule in prose, with the lifecycle of the folder, lives in `docs/`:**
[docs/architecture/frozen-wit.md](../../../../docs/architecture/frozen-wit.md).
