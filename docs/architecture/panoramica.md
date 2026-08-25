# Panoramica dell'architettura

Fub è diviso in strati con responsabilità strette. La direzione generale è:

```text
frontend
  → fub-app
  → fub-host
  → fub-kernel
  → provider definiti da fub-abi
  → file, indici e servizi locali
```

## I confini

### `fub-abi`: il contratto

Contiene tipi, trait, errori e rappresentazioni che possono attraversare i confini del sistema. Non conosce Tauri, Markdown, Wasmtime o il motore di ricerca.

### `fub-kernel`: le regole del vault

Gestisce documenti, registri, sessioni, capacità, mutazioni, bozze e regole di accesso. È agnostico rispetto al formato dei documenti e alla tecnologia dell'interfaccia.

### Provider e funzionalità

`fub-format-markdown` interpreta il Markdown. `fub-features` raccoglie le funzionalità ufficiali. Entrambi programmano contro `fub-abi`; le funzionalità ufficiali non dipendono normalmente dal kernel, così restano un banco realistico per il modello dei plugin.

### `fub-host`: il composition root

Apre il vault, costruisce il registro dei provider, monta i bundle ufficiali, collega watcher, lavori lunghi, impostazioni e bus degli eventi. Non dipende da Tauri.

### `fub-app`: la colla desktop

Espone i comandi e gli eventi Tauri e traduce il contratto Rust verso la webview. Non deve contenere regole di dominio che appartengono all'host o al kernel.

### `frontend`: la shell

Disegna l'interfaccia, mantiene lo stato delle viste e comunica con il backend attraverso un confine IPC ristretto. Gli import Tauri sono concentrati negli adattatori sotto `frontend/src/host/`.

### `fub-wasm-host`: il runtime dei componenti

È l'unico crate che deve conoscere Wasmtime. Traduce il contratto WIT verso l'host senza spostare il runtime dentro il kernel.

## Perché questa divisione conta

- il formato Markdown può essere sostituito o affiancato;
- la shell può cambiare senza riscrivere il core;
- l'host può essere riusato da client diversi da Tauri;
- provider nativi e componenti WASM condividono lo stesso vocabolario;
- i test possono costruire il sistema senza avviare una webview.

Il grafo completo, confrontato automaticamente con i `Cargo.toml`, è in [`03-uml/03-componenti-e-dipendenze.md`](../03-uml/03-componenti-e-dipendenze.md).