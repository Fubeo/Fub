# Esempi e strumenti di supporto

## Gli esempi pratici (`esempi/`)

Nella cartella [`esempi/`](../../esempi) trovi diversi progetti che mostrano come scrivere plugin WebAssembly compatibili con Fub:

1. [`esempi/ping-wasm`](../../esempi/ping-wasm): un plugin minimale che implementa il ciclo di vita `Plugin` ed espone un semplice comando "conta" o "ping".
2. [`esempi/ciclo-wasm`](../../esempi/ciclo-wasm): mostra l'attivazione e la disattivazione controllata con rilascio delle risorse.
3. [`esempi/eventi-wasm`](../../esempi/eventi-wasm): dimostra come un componente WASM può ricevere e gestire eventi inviati dal vault.
4. [`esempi/modello-wasm`](../../esempi/modello-wasm): mostra come manipolare la struttura del documento attraverso il varco WebAssembly.

Tutti gli esempi compilano per il target WebAssembly `wasm32-wasip2` usando `cargo build --target wasm32-wasip2`.

---

## Gli strumenti (`tools/`)

Nella cartella [`tools/`](../../tools) si trovano strumenti per la verifica dei contratti:

- [`tools/varco-wasm`](../../tools/varco-wasm): compila il contratto WIT per il target `wasm32-unknown-unknown` per garantire che l'interfaccia possa sempre attraversare il confine WebAssembly senza errori di compilazione.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/04-esempio-ping.md`](../04-plugin/04-esempio-ping.md) per l'analisi dettagliata del codice di `esempi/ping-wasm`.
