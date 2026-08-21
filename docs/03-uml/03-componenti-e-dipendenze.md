# Componenti e dipendenze del workspace

## Il grafo delle dipendenze

Il diagramma seguente mostra tutti i crate Rust presenti nel workspace e le relazioni tra di essi.
- **Freccia continua (`-->`)**: dipendenza normale (il modulo è necessario per compilare ed eseguire la libreria).
- **Freccia tratteggiata (`-.->`)**: dipendenza di solo test (`[dev-dependencies]`, usata solo durante l'esecuzione dei test automatici).

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

---

## Regole chiave dell'architettura

1. **`fub-abi` non dipende da nessuno**: è la radice di tutto il sistema. Contiene solo definizioni di tipi e trait, senza dipendere da motori grafici, parser o runtime esterni.
2. **`fub-features` non dipende dal kernel**: le funzionalità ufficiali (ricerca, tag, grafici) usano unicamente le interfacce pubbliche di `fub-abi`, esattamente come farà un plugin di terze parti.
3. **`fub-testkit` non entra in nessuna libreria**: serve solo per eseguire test automatici e non viene mai incluso nei file finali distribuiti all'utente.
4. **`fub-host` non dipende da Tauri**: l'assemblaggio di Fub è separato dall'interfaccia grafica per consentire in futuro l'uso da riga di comando (CLI) o altri ambienti.

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-abi/tests/dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs) per il test automatico che verifica la fedeltà di questo diagramma.
- Guarda la panoramica in [`docs/02-componenti/01-panoramica.md`](../02-componenti/01-panoramica.md) per la spiegazione dettagliata di ciascun crate.
