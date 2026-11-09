# crates/fub-abi/wit/frozen/

A copy of the contract for every **published** version, with the file name
matching the version (`0.1.0.wit` ↔ `package fub:abi@0.1.0`).

It is not an archive: it is the baseline against which
[`wit_additivity.rs`](../../tests/wit_additivity.rs) verifies the promise on
which M4's freeze rests — post-freeze the contract grows only by addition.

The snapshots: `0.1.0.wit`, `0.1.1.wit` and `0.2.0.wit`, the version
published with the pre-alpha. The rule depends on the snapshot: against
`0.1.x` a field appended to a record and a case appended to an `enum`,
`variant` or `flags` still pass (the rule those versions were frozen with).
Against `0.2.0` and every later version:

- a record, `enum`, `variant` or `flags` that crosses the boundary (reached
  by a signature of a `world`, import or export) keeps exactly the same
  fields or cases, in the same order (ADR 0235, ADR 0238);
- an interface the plugin exports keeps exactly the same functions;
- a new function in an interface the plugin imports, a new interface and a
  type that no signature reaches still grow as before.

A snapshot is never edited to make the test pass.

**The rule in prose, with the lifecycle of the folder, lives in `docs/`:**
[../../../../docs/reference/abi-and-wit.md](../../../../docs/reference/abi-and-wit.md).
