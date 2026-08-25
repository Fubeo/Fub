# Componenti e dipendenze del workspace

## Grafo verificato

Il diagramma mostra tutti i crate Rust del workspace e le dipendenze fra membri.

- `-->`: dipendenza normale;
- `-.->`: dipendenza presente soltanto in `[dev-dependencies]`.

```mermaid
flowchart TD
    %% @grafo-dipendenze
    %% Questo blocco è letto e confrontato con `cargo metadata` da crates/fub-abi/tests/dependency_invariant.rs.
    classDef contract fill:#4c1d95,stroke:#8b5cf6,stroke-width:2px,color:#fff
    classDef core     fill:#2d3748,stroke:#718096,stroke-width:2px,color:#fff
    classDef provider fill:#1a365d,stroke:#2b6cb0,stroke-width:2px,color:#fff
    classDef mount    fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    classDef glue     fill:#7c2d12,stroke:#ea580c,stroke-width:2px,color:#fff
    classDef banco    fill:#4a044e,stroke:#c026d3,stroke-width:2px,color:#fff

    app["fub-app"]:::glue
    host["fub-host"]:::mount
    features["fub-features"]:::provider
    markdown["fub-format-markdown"]:::provider
    wasmhost["fub-wasm-host"]:::provider
    sdk["fub-sdk"]:::provider
    testkit["fub-testkit"]:::banco
    kernel["fub-kernel"]:::core
    abi["fub-abi"]:::contract

    app --> abi
    app --> host
    app --> kernel
    host --> abi
    host --> features
    host --> markdown
    host --> kernel
    features --> abi
    markdown --> abi
    markdown --> sdk
    wasmhost --> abi
    wasmhost --> host
    wasmhost --> kernel
    kernel --> abi
    sdk --> abi
    testkit --> abi
    testkit --> kernel

    features -.-> kernel
    features -.-> markdown
    features -.-> sdk
    features -.-> testkit
    markdown -.-> kernel
    kernel -.-> testkit
    host -.-> testkit
    wasmhost -.-> testkit
```

## Invarianti principali

1. `fub-abi` non dipende da altri crate del workspace ed evita dipendenze legate a UI, formato e runtime.
2. `fub-features` usa `fub-abi` come una vera estensione; il kernel compare soltanto nei test.
3. `fub-testkit` è un banco di prova e non entra come dipendenza normale nelle librerie.
4. `fub-host` assembla il sistema senza dipendere da Tauri.
5. `fub-app` è il solo adattatore desktop e non sostituisce il composition root.

## Fonte di verità

Il test [`dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs) legge il blocco marcato `@grafo-dipendenze` e lo confronta nei due versi con i manifest. Un crate o una freccia mancanti rendono la CI rossa.

Per una descrizione dei componenti consulta [`riferimento/componenti.md`](../riferimento/componenti.md).