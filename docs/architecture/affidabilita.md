# Affidabilità e presidi

Fub tratta molte regole architetturali come proprietà eseguibili, non come frasi da ricordare.

## Confini di dipendenza

`crates/fub-abi/tests/dependency_invariant.rs` verifica, fra le altre cose, che:

- ABI e kernel non importino UI, parser Markdown o runtime WASM;
- le funzionalità ufficiali non dipendano normalmente dal kernel;
- l'SDK non trascini il kernel nei provider;
- l'host non dipenda da Tauri;
- il diagramma dei crate corrisponda ai `Cargo.toml`.

## Contratto

- `wit_conformance.rs` confronta Rust e WIT;
- `wit_additivity.rs` confronta il contratto vivo con le baseline;
- il varco WASM viene compilato in CI;
- i mirror TypeScript generati sono confrontati con i tipi Rust.

## Dati

Test specifici verificano schemi su disco, scritture, path, lock, recupero e comportamento cross-platform. La CI esegue il workspace su Linux, Windows e macOS.

## Frontend

Type-check, unit test, build, controlli sui listener e sulle corse concorrenti, banco visuale e verifica dell'accessibilità coprono la shell.

## Documentazione

Tre script distinti controllano:

- link interni;
- affermazioni numeriche collegate ai sorgenti;
- integrità delle tabelle Markdown.

Il ciclo completo e le eccezioni sono in [`CONTRIBUTING.md`](../CONTRIBUTING.md).