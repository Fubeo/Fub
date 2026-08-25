# Struttura del repository

```text
Fub/
├── Cargo.toml                 workspace Rust e versioni condivise
├── crates/                    librerie e applicazione desktop
├── frontend/                  shell TypeScript, test e banco visuale
├── docs/                      documentazione mantenuta
├── esempi/                    componenti e scenari dimostrativi
├── tools/                     strumenti fuori dal workspace principale
├── tests/                     fixture e dati di prova condivisi
├── .github/                   CI e controlli automatici
├── deny.toml                  politica supply-chain
└── AGENTS.md                  regole operative per chi modifica il repo
```

## Dove mettere una modifica

| Modifica | Posizione principale |
|---|---|
| tipo o trait condiviso | `crates/fub-abi/` |
| regola del vault o mutazione | `crates/fub-kernel/` |
| parsing Markdown | `crates/fub-format-markdown/` |
| funzionalità ufficiale | `crates/fub-features/` |
| composizione, apertura o watcher | `crates/fub-host/` |
| runtime WASM | `crates/fub-wasm-host/` |
| comando o evento Tauri | `crates/fub-app/` |
| pannello o interazione della shell | `frontend/src/` |
| requisito di prodotto | `docs/features/` o `docs/microfeatures/` |
| scelta architetturale nuova | `docs/decisions/` e documento corrente interessato |
| attività aperta | `docs/todo.md` |

## Regola pratica

Non creare un secondo documento che rispiega lo stesso argomento. Aggiorna la pagina canonica e usa un link dagli altri punti. Le specifiche future devono dichiarare di essere specifiche, non documentazione del comportamento corrente.