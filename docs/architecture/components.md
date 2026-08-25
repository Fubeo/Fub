# Componenti e dipendenze

> **Stato:** implementato  
> **Fonte di verità:** `Cargo.toml` e manifest dei crate

## Componenti

| Componente | Responsabilità | Dipendenze vietate |
|---|---|---|
| `fub-abi` | tipi, trait, WIT, rappresentazioni IPC | Tauri, Wasmtime, Comrak |
| `fub-kernel` | workspace, documenti, indici, policy, eventi | Tauri, Wasmtime, Markdown |
| `fub-sdk` | helper per autori e host in memoria | kernel concreto |
| `fub-testkit` | integrazione reale per test | dipendenza normale dei crate |
| `fub-format-markdown` | parsing e resa Markdown | Tauri |
| `fub-features` | funzionalità ufficiali come provider | accoppiamenti fra bundle |
| `fub-host` | sessioni, montaggio, watcher, job | Tauri |
| `fub-wasm-host` | linker Wasmtime e proxy | Tauri |
| `fub-app` | binario e adattatori Tauri | logica di dominio |
| `frontend` | shell, editor, pannelli e tema | accesso diretto al disco |

## Grafo logico

```mermaid
flowchart LR
    App["fub-app"] --> Host["fub-host"]
    App --> Wasm["fub-wasm-host"]
    Host --> Kernel["fub-kernel"]
    Host --> Features["fub-features"]
    Host --> Markdown["fub-format-markdown"]
    Kernel --> ABI["fub-abi"]
    Features --> ABI
    Markdown --> ABI
    Wasm --> ABI
    SDK["fub-sdk"] --> ABI
    Testkit["fub-testkit"] -. test .-> Kernel
```

Il test di dipendenza deve confrontare questo grafo con i manifest reali. Una nuova freccia richiede una decisione, non soltanto una modifica al diagramma.

## Composizione

`fub-host` è la composition root riusabile. Una CLI o un test headless devono poter montare il sistema senza inizializzare una webview. `fub-app` aggiunge soltanto ciò che richiede Tauri.
