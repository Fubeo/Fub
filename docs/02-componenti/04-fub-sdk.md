# `fub-sdk` — helper per provider Rust

[`crates/fub-sdk/`](../../crates/fub-sdk) raccoglie codice riutilizzabile da chi
implementa i trait di `fub-abi`. Riduce la duplicazione senza portare il kernel
dentro i provider.

## Cosa contiene

| Modulo | Responsabilità |
|---|---|
| [`lib.rs`](../../crates/fub-sdk/src/lib.rs) | Riesporta il contratto come `fub_sdk::abi` e rende pubblici gli helper. |
| [`ids.rs`](../../crates/fub-sdk/src/ids.rs) | Costruisce UUID e identificativi brevi usando l'entropia concessa dall'host. |
| [`scan.rs`](../../crates/fub-sdk/src/scan.rs) | Scansione testuale condivisa per tag e wikilink, indipendente da un parser di formato. |
| [`ui.rs`](../../crates/fub-sdk/src/ui.rs) | Costruttori ergonomici per nodi dell'interfaccia dichiarativa `UiNode`. |
| [`testing/mod.rs`](../../crates/fub-sdk/src/testing/mod.rs) | `MemoryHost`, un'implementazione in memoria di `HostApi` per testare provider isolati. |
| [`testing/conformance.rs`](../../crates/fub-sdk/src/testing/conformance.rs) | Suite riutilizzabili che verificano gli invarianti dei provider. |

## Confine con il kernel

`fub-sdk` dipende da `fub-abi`, ma non da `fub-kernel`. Questa separazione è
necessaria perché un provider deve poter essere provato contro il contratto
senza aprire un vault reale e senza importare dettagli interni dell'host.

I due banchi hanno scopi diversi:

| Strumento | Cosa prova |
|---|---|
| `fub-sdk::testing` | Un provider contro un host in memoria e le regole del contratto. |
| [`fub-testkit`](10-fub-testkit.md) | Più componenti contro il kernel reale e un filesystem temporaneo. |

## Rapporto con i componenti WASM

Il crate è scritto in Rust e oggi viene usato direttamente dai provider nativi.
Gli esempi WASM del repository non lo collegano nel componente: generano i tipi
dal WIT con `wit-bindgen` e non dipendono nemmeno dal crate Rust `fub-abi`.

Gli stessi concetti ergonomici potranno essere offerti in futuro anche a guest
WASM, ma questo non è ancora un percorso di dipendenza disponibile. Il contratto
condiviso fra linguaggi resta il WIT, non questo crate.

## Dipendenze

Le dipendenze di produzione sono `fub-abi`, `serde`, `serde_json` e `regex`.
L'invariante che vieta l'ingresso del kernel è controllata dai test di dipendenza
di `fub-abi`.

Per il runtime dei componenti vedere [`08-fub-wasm-host.md`](08-fub-wasm-host.md).
