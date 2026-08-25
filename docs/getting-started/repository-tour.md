# Orientarsi nella repository

> **Per chi:** chi deve trovare il punto giusto da modificare.
> **Risultato:** passare da un comportamento a crate, modulo e test pertinenti.

## Mappa

```text
Fub/
├── crates/                 workspace Rust
│   ├── fub-abi/
│   ├── fub-kernel/
│   ├── fub-host/
│   ├── fub-app/
│   ├── fub-sdk/
│   ├── fub-testkit/
│   ├── fub-format-markdown/
│   ├── fub-features/
│   └── fub-wasm-host/
├── frontend/               shell Vite e TypeScript
├── esempi/                 componenti WASM eseguiti dai test
├── tools/                  verifiche fuori dal workspace
├── docs/                   documentazione canonica
└── .github/                workflow e guard
```

## Dove modificare cosa

| Obiettivo | Punto di partenza |
|---|---|
| aggiungere o cambiare un tipo condiviso | `crates/fub-abi/src/` |
| cambiare il modello del documento | `crates/fub-abi/src/model.rs` |
| cambiare una firma che attraversa WASM | `crates/fub-abi/wit/fub/abi.wit` |
| cambiare workspace, path, storage o indici | `crates/fub-kernel/src/` |
| cambiare mount, sessioni, job o impostazioni | `crates/fub-host/src/` |
| aggiungere un comando Tauri o adattare IPC | `crates/fub-app/src/lib.rs` |
| cambiare parsing o rendering Markdown | `crates/fub-format-markdown/src/` |
| cambiare ricerca, grafo o feature ufficiali | `crates/fub-features/src/` |
| cambiare il runtime dei componenti | `crates/fub-wasm-host/src/` |
| cambiare editor, pannelli o tema | `frontend/src/` |
| testare un provider in memoria | `crates/fub-sdk/` |
| testare host e kernel insieme | `crates/fub-testkit/` |

## I nove crate

| Crate | Responsabilità |
|---|---|
| `fub-abi` | tipi, trait, errori, regole, WIT e forme IPC |
| `fub-kernel` | workspace, storage, indici, policy ed eventi |
| `fub-host` | composition root, sessioni, bundle, watcher e job |
| `fub-app` | binario Tauri e adattatori IPC |
| `fub-sdk` | helper per gli autori e `MemoryHost` |
| `fub-testkit` | banco di integrazione host/kernel |
| `fub-format-markdown` | provider Markdown |
| `fub-features` | feature ufficiali dietro feature Cargo |
| `fub-wasm-host` | adattatore Wasmtime verso i trait comuni |

## Flusso per tipo di modifica

### Una nuova capacità del prodotto

1. definisci il comportamento osservabile;
2. usa un trait o un registro esistente;
3. implementa il provider nel crate proprietario;
4. monta il provider in `fub-host`;
5. esponi soltanto l'adattamento necessario in `fub-app`;
6. usa il seam `frontend/src/host/` nella shell;
7. aggiungi test al livello più basso e un'integrazione sul flusso.

### Un nuovo formato

1. riusa il modello comune o motiva l'estensione;
2. implementa `FormatProvider` fuori dal kernel;
3. registra estensioni e capacità;
4. verifica parse, render, serializzazione e trasferimento;
5. evita rami `if markdown` nel core.

### Un nuovo plugin WASM

Parti da [`development/plugin-authoring.md`](../development/plugin-authoring.md)
e dagli esempi in `esempi/`.

## Confini da ricordare

- il kernel non importa Tauri, Wasmtime o Markdown;
- l'host non importa Tauri;
- Wasmtime resta in `fub-wasm-host`;
- i tipi condivisi non nascono nel frontend;
- una feature ufficiale può essere spenta senza rompere il workspace;
- il codice di test non entra nelle dipendenze normali.

Il grafo completo è in
[`architecture/components-and-boundaries.md`](../architecture/components-and-boundaries.md).
