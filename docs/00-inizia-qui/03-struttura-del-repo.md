# Struttura del repository

## Flusso principale

```text
frontend/src
  -> crates/fub-app
  -> crates/fub-host
  -> crates/fub-kernel
  -> provider definiti da fub-abi
  -> storage e indici
```

Gli eventi tornano verso la shell attraverso il bus del workspace, l'host e il
canale Tauri. Gli indici vengono aggiornati dal proprietario corretto, non da un
secondo giro di eventi.

## Cartelle principali

| Percorso | Responsabilità |
|---|---|
| `crates/fub-abi/` | Contratto pubblico: tipi, trait, errori, WIT e forme IPC. |
| `crates/fub-kernel/` | Workspace indipendente da Tauri, Wasmtime e Markdown. |
| `crates/fub-sdk/` | Helper per provider e host in memoria per test di contratto. |
| `crates/fub-testkit/` | Banco di integrazione lato host, solo come dipendenza di sviluppo. |
| `crates/fub-format-markdown/` | Implementazione Markdown del contratto di formato. |
| `crates/fub-features/` | Funzionalità ufficiali montate come provider nativi. |
| `crates/fub-host/` | Sessioni, bundle, watcher, impostazioni e job. |
| `crates/fub-wasm-host/` | Wasmtime e adattatori dei componenti WASM. |
| `crates/fub-app/` | Binario desktop e adattatori IPC Tauri. |
| `frontend/src/` | Shell, stato, pannelli, temi e confine tipizzato con l'host. |
| `frontend/bench/` | Scene e controlli visuali/accessibilità. |
| `esempi/` | Esempi di provider, inclusi componenti WASM. |
| `tools/` | Strumenti fuori dal workspace principale. |
| `.github/scripts/` | Controlli meccanici di architettura, documentazione e CI. |
| `docs/` | Guida, stato corrente, inventari e memoria storica. |

## Confini da non attraversare

- `fub-abi` non conosce Markdown, Tauri o Wasmtime.
- `fub-kernel` dipende dai trait, non dalle implementazioni concrete.
- `fub-host` non dipende da Tauri.
- `fub-app` contiene adattatori IPC, non logica di dominio riutilizzabile.
- soltanto `fub-wasm-host` nomina Wasmtime.
- nel frontend, le API Tauri restano nei moduli di confine dedicati.

## Come è organizzata `docs/`

| Categoria | Percorsi | Uso |
|---|---|---|
| Guida corrente | `00-inizia-qui/` … `07-ui/` | Spiega il sistema presente. |
| Stato corrente | `FEATURES.md`, `PIANO.md`, `todo.md`, `milestones/` | Distingue completato, parziale e aperto. |
| Inventari | `features/`, `microfeatures/` | Descrive requisiti e gesti da coprire. |
| Storico | `decisions/`, `roadmap/` | Conserva il perché delle scelte. |
| Compatibilità | `architecture/`, `appendix/` | Mantiene validi collegamenti storici verso la guida canonica. |

L'indice completo è [`../README.md`](../README.md).
