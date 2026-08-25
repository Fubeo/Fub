# `fub-host` — composizione e sessioni

[`crates/fub-host/`](../../crates/fub-host) assembla il backend senza dipendere
da Tauri. Apre i vault, monta formati e funzionalità, gestisce il lavoro in
background e offre alla shell un'API riutilizzabile anche da altri client.

## Responsabilità

- mantenere più sessioni di vault e scegliere quella corrente;
- costruire il `Workspace` con formati, feature ufficiali e impostazioni;
- possedere i bundle montati e il loro ciclo di vita;
- proteggere l'accesso concorrente al workspace;
- eseguire i job fuori dal percorso sincrono della shell;
- osservare le modifiche esterne del filesystem;
- inoltrare gli eventi verso un `EventSink` scelto dal client;
- gestire configurazione macchina, registro dei vault, temi e impostazioni;
- offrire, quando abilitate, rete HTTP e conversioni del tempo civile.

## Moduli principali

| Modulo | Responsabilità |
|---|---|
| [`session.rs`](../../crates/fub-host/src/session.rs) | `Host`, `VaultSession`, apertura, chiusura e accesso alle sessioni. |
| [`mount.rs`](../../crates/fub-host/src/mount.rs) | Composizione del workspace e registrazioni specifiche delle feature ufficiali. |
| [`registry.rs`](../../crates/fub-host/src/registry.rs) | `Bundle`, `BundleRegistry`, proprietà e ciclo di vita dei provider montati. |
| [`custody.rs`](../../crates/fub-host/src/custody.rs) | Accesso sincronizzato al workspace e politica sui lock avvelenati. |
| [`runner.rs`](../../crates/fub-host/src/runner.rs) | Pool dei job, cancellazione e arresto ordinato. |
| [`jobs.rs`](../../crates/fub-host/src/jobs.rs) | `JobHost`, cioè le capacità prestate a un lavoro in esecuzione. |
| [`watcher.rs`](../../crates/fub-host/src/watcher.rs) | Astrazione del watcher, sincronizzazione esterna e implementazione basata su `notify`. |
| [`bridge.rs`](../../crates/fub-host/src/bridge.rs) | Ponte fra eventi del kernel e destinazione scelta dal client. |
| [`settings.rs`](../../crates/fub-host/src/settings.rs) | Impostazioni dell'app e del vault. |
| [`config.rs`](../../crates/fub-host/src/config.rs) | Cartella di configurazione, log e diagnosi di avvio. |
| [`vaults.rs`](../../crates/fub-host/src/vaults.rs) | Registro persistente dei vault conosciuti. |
| [`theme.rs`](../../crates/fub-host/src/theme.rs) | Sorgenti e metadati dei temi disponibili all'host. |
| [`net.rs`](../../crates/fub-host/src/net.rs) | Client HTTP opzionale usato attraverso le capacità del contratto. |
| [`wall.rs`](../../crates/fub-host/src/wall.rs) | Conversione fra istanti e tempo civile con fuso orario. |
| [`shell.rs`](../../crates/fub-host/src/shell.rs) | Dati e operazioni destinati ai client della shell. |

## Confini

`fub-host` dipende da `fub-abi`, `fub-kernel`, `fub-features` e
`fub-format-markdown`. Non dipende da Tauri: `fub-app` aggiunge quel confine.
Non dipende da Wasmtime: `fub-wasm-host` dipende dall'host per implementare lo
stesso tipo `Bundle`, non il contrario.

Questo verso permette a un client che non usa plugin WASM di montare Fub senza
compilare Wasmtime e impedisce al runtime di contaminare il percorso nativo.

## Feature di compilazione

La configurazione predefinita abilita:

- `notify-watcher` per il watcher desktop;
- `http-client` per la capacità di rete;
- `official-features` per tutti i bundle ufficiali.

Build headless o mirate possono disabilitare queste parti e fornire
implementazioni alternative dei confini pubblici.

## Rapporto con l'app

`fub-app` traduce IPC e dialoghi in chiamate all'host. Il montaggio, il watcher,
il runner e le sessioni non vivono nei comandi Tauri e possono quindi essere
riutilizzati da test o client futuri.

Per il flusso dei thread vedere
[`../03-uml/04-processi-e-thread.md`](../03-uml/04-processi-e-thread.md).
