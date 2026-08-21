# crates/fub-abi/wit/

The **WIT** contract of Fub — that is, `fub-abi` written a second time in the
language of WASM components.

It lives inside `fub-abi` rather than at the repo root because it is the
**twin of this crate**: it describes the same types, changes when they change,
and the two tests that verify it —
[`wit_conformance.rs`](../tests/wit_conformance.rs) and
[`wit_additivity.rs`](../tests/wit_additivity.rs) — live right next to it.
While it was at the root those tests had to travel two levels up out of their
own crate to read a file that was theirs anyway.

- The live contract: [`fub/abi.wit`](fub/abi.wit) — package `fub:abi@0.1.1`.
- The contract **as it was**, version by version: [`frozen/`](frozen/).

**The documentation lives in `docs/`**, not here:

- why this tree exists, what it governs, and how to update it →
  [docs/06-contratto/03-il-contratto-wit.md](../../../docs/06-contratto/03-il-contratto-wit.md);
- the frozen baseline and the additivity promise →
  [docs/06-contratto/03-il-contratto-wit.md#la-regola-del-freeze-crescere-solo-per-aggiunta](../../../docs/06-contratto/03-il-contratto-wit.md#la-regola-del-freeze-crescere-solo-per-aggiunta).

