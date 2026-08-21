# `fub-host` — L'assemblatore di sistema

Per chi è: studenti che vogliono capire come vengono uniti e coordinati i vari pezzi del backend prima di collegarli all'interfaccia grafica.

---

## A cosa serve

[`crates/fub-host`](../../crates/fub-host) è il punto di montaggio (*composition root*) del backend. Il suo compito è:
- Creare e inizializzare il `Workspace` quando si apre una cartella vault.
- Registrare i provider (il parser Markdown, le feature integrate, ecc.).
- Gestire la concorrenza tramite il wrapper [`Custodia`](../../crates/fub-host/src/custody.rs), che protegge il workspace con un `RwLock`.
- Avviare il pool di thread per i job in background (`runner.rs`).
- Monitorare il filesystem tramite `notify` (`watcher.rs`).

---

## Dipendenze

- **Dipendenze interne**: collega insieme [`fub-abi`](../../crates/fub-abi), [`fub-kernel`](../../crates/fub-kernel), [`fub-features`](../../crates/fub-features) e [`fub-format-markdown`](../../crates/fub-format-markdown).
- **Invariante fondamentale**: **`fub-host` non dipende da Tauri**. Questo permette a Fub di essere avviato anche senza interfaccia grafica (per esempio da una riga di comando o in test automatici).

---

## File chiave del modulo

- [`crates/fub-host/src/session.rs`](../../crates/fub-host/src/session.rs): gestisce la durata di vita della sessione di un vault (`VaultSession`).
- [`crates/fub-host/src/custody.rs`](../../crates/fub-host/src/custody.rs): controlla gli accessi concorrenti in lettura/scrittura sul workspace e gestisce eventuali panici.
- [`crates/fub-host/src/bridge.rs`](../../crates/fub-host/src/bridge.rs): thread ponte che preleva gli eventi dal kernel e li consegna alla destinazione (es. la webview).
- [`crates/fub-host/src/watcher.rs`](../../crates/fub-host/src/watcher.rs): rilevatore che avvisa Fub quando altri programmi modificano i file delle note sul disco.
- [`crates/fub-host/src/runner.rs`](../../crates/fub-host/src/runner.rs): esecutore di compiti in background con supporto per la cancellazione controllata.

---

## Se vuoi il dettaglio

- Guarda [`docs/03-uml/04-processi-e-thread.md`](../03-uml/04-processi-e-thread.md) per lo schema dell'architettura runtime.
