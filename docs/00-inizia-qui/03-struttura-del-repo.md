# Struttura del repository

## Albero delle cartelle

```
Fub/
├── crates/             # Moduli backend in Rust
│   ├── fub-abi/        # Il contratto comune (tipi, trait e definizioni WIT)
│   ├── fub-kernel/     # Il motore centrale (file, eventi, indici)
│   ├── fub-host/       # L'assemblatore (sessione, lock, watcher, thread)
│   ├── fub-features/   # Le funzionalità ufficiali (ricerca, tag, grafo)
│   ├── fub-format-markdown/ # Il parser per i file Markdown (.md)
│   ├── fub-wasm-host/  # Il runtime WebAssembly per plugin WASM
│   ├── fub-app/        # L'app desktop Tauri v2 (IPC, finestre)
│   ├── fub-sdk/        # Strumenti di sviluppo per scrivere plugin
│   └── fub-testkit/    # Strumenti di test per simulare l'host
├── frontend/           # Interfaccia grafica (TypeScript, Vite, CodeMirror 6)
│   ├── src/editor/     # Editor di testo, evidenziazione sintassi, anteprima
│   ├── src/panels/     # Pannelli (esplora risorse, ricerca, grafo, ecc.)
│   ├── src/ui/         # Interprete dei componenti dichiarativi UiNode
│   └── src/host/       # Chiamate IPC verso il backend Rust
├── esempi/             # Plugin di esempio (es. ping-wasm, ciclo-wasm)
├── tools/              # Strumenti di verifica del contratto (es. varco-wasm)
├── tests/              # Test di integrazione e fixture di prova (es. sample-vault)
├── docs/               # Tutta la documentazione del progetto
└── .github/            # Script di automazione e workflow per la CI
```

---

## Dove cercare cosa

- **Vuoi cambiare l'aspetto visivo o l'editor?** → [`frontend/`](../../frontend)
- **Vuoi capire come vengono salvati i file?** → [`crates/fub-kernel/`](../../crates/fub-kernel)
- **Vuoi creare una nuova interfaccia o un nuovo tipo di documento?** → [`crates/fub-abi/`](../../crates/fub-abi)
- **Vuoi vedere o sviluppare un plugin WASM?** → [`docs/04-plugin/`](../04-plugin/01-nativo-vs-wasm.md) e [`esempi/ping-wasm/`](../../esempi/ping-wasm)
- **Vuoi conoscere la struttura dei file e di `.fub/` su disco?** → [`docs/05-disco/`](../05-disco/01-note-utente.md)
- **Vuoi consultare le decisioni architetturali (ADR) o la roadmap?** → [`docs/decisions/`](../decisions/README.md)
- **Vuoi contribuire al codice e conoscere le regole di qualità?** → [`docs/CONTRIBUTING.md`](../CONTRIBUTING.md)

---

## Se vuoi il dettaglio

- Guarda le schede dettagliate dei singoli moduli in [`docs/02-componenti/`](../02-componenti/01-panoramica.md).
- Approfondisci i concetti di base in [`docs/01-concetti/`](../01-concetti/01-il-vault.md).
