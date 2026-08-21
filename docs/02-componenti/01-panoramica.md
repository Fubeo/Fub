# Panoramica dei componenti

## La suddivisione in moduli

Fub è organizzato come un **workspace multi-crate**, cioè un progetto suddiviso in diversi pacchetti indipendenti, ciascuno con un compito ben preciso e confini stabiliti.

```mermaid
flowchart LR
    A["frontend/<br>(UI TypeScript)"] --> B["fub-app<br>(Colla Tauri)"]
    B --> C["fub-host<br>(Montaggio)"]
    C --> D["fub-kernel<br>(Motore Vault)"]
    C --> E["fub-features<br>(Funzioni)"]
    C --> F["fub-format-markdown<br>(Parser)"]
    C --> G["fub-wasm-host<br>(Runtime WASM)"]
    D --> H["fub-abi<br>(Contratto)"]
    E --> H
    F --> H
    G --> H
    F --> I["fub-sdk<br>(Helper)"]
    I --> H
```

---

## Tabella dei componenti

| Componente | Cartella sul disco | Linguaggio | A cosa serve |
|---|---|---|---|
| **fub-abi** | [`crates/fub-abi`](../../crates/fub-abi) | Rust + WIT | Il contratto comune: definisce tutti i tipi e i trait del sistema. Non compie I/O. |
| **fub-kernel** | [`crates/fub-kernel`](../../crates/fub-kernel) | Rust | Il motore centrale: gestisce lo stato dei file, l'anagrafe delle note e gli indici. |
| **fub-sdk** | [`crates/fub-sdk`](../../crates/fub-sdk) | Rust | Strumenti di supporto per chi scrive plugin e test di conformità. |
| **fub-format-markdown** | [`crates/fub-format-markdown`](../../crates/fub-format-markdown) | Rust | Il primo provider nativo: legge, analizza e converte file Markdown con `comrak`. |
| **fub-features** | [`crates/fub-features`](../../crates/fub-features) | Rust | Le funzionalità ufficiali (ricerca full-text con tantivy, grafo, backlink, tag, versioning). |
| **fub-host** | [`crates/fub-host`](../../crates/fub-host) | Rust | Assembla tutti i pezzi, gestisce la sessione del vault, il file watcher e i thread dei job. |
| **fub-wasm-host** | [`crates/fub-wasm-host`](../../crates/fub-wasm-host) | Rust | Esegue plugin di terze parti in formato WebAssembly tramite `wasmtime`. |
| **fub-app** | [`crates/fub-app`](../../crates/fub-app) | Rust | L'applicazione desktop basata su Tauri v2: collega l'interfaccia web al backend. |
| **fub-testkit** | [`crates/fub-testkit`](../../crates/fub-testkit) | Rust | Strumenti di collaudo e test per simulare vault ed eventi senza aprire la finestra grafica. |
| **frontend** | [`frontend`](../../frontend) | TypeScript | L'interfaccia grafica: layout, pannelli, navigazione e l'editor CodeMirror 6. |
| **esempi** | [`esempi`](../../esempi) | Rust | Esempi pratici di plugin (come `ping-wasm`, `ciclo-wasm`, `eventi-wasm`, `modello-wasm`). |
| **tools** | [`tools`](../../tools) | Rust | Strumenti di supporto per la compilazione e verifica del varco WebAssembly (`varco-wasm`). |

---

## Se vuoi il dettaglio

Esplora le schede dedicate ai singoli componenti in questa cartella (`docs/02-componenti/`).
