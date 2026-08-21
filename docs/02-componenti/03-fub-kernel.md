# `fub-kernel` — Il motore centrale

## A cosa serve

[`crates/fub-kernel`](../../crates/fub-kernel) è il cuore del programma. Si occupa di:
- Tenere in memoria lo stato del vault aperto nella struttura [`Workspace`](../../crates/fub-kernel/src/workspace.rs).
- Gestire il catalogo e l'anagrafe dei documenti (`DocumentStore`).
- Mantenere il grafo dei collegamenti tra note (`LinkGraph`).
- Gestire l'instradamento degli eventi (`EventBus` e `Dispatcher`).
- Applicare i permessi di sicurezza alle chiamate dei plugin (`guard.rs`).

Il kernel è **agnostico rispetto al formato**: non sa cosa sia la sintassi Markdown, ma usa i provider registrati per capire i documenti.

---

## Dipendenze

- **Dipendenze interne**: dipende da [`fub-abi`](../../crates/fub-abi).
- **Dipendenze esterne**: `serde`, `serde_json`, `camino` (percorsi UTF-8 puliti), `thiserror`, `tracing` (logging). Su Windows include `windows-sys` per leggere informazioni avanzate sui file.

---

## File chiave del modulo

- [`crates/fub-kernel/src/workspace.rs`](../../crates/fub-kernel/src/workspace.rs): la struttura centrale che possiede i documenti, gli indici e il registro dei provider.
- [`crates/fub-kernel/src/entries.rs`](../../crates/fub-kernel/src/entries.rs): la mappa dei file del vault presenti su disco.
- [`crates/fub-kernel/src/bus.rs`](../../crates/fub-kernel/src/bus.rs): il canale interno che smista gli eventi emessi durante l'uso.
- [`crates/fub-kernel/src/dispatcher.rs`](../../crates/fub-kernel/src/dispatcher.rs): la coda degli eventi in attesa di essere consegnati.
- [`crates/fub-kernel/src/host/guard.rs`](../../crates/fub-kernel/src/host/guard.rs): la guardia che controlla se un plugin ha il permesso di compiere una certa azione.
- [`crates/fub-kernel/src/journal.rs`](../../crates/fub-kernel/src/journal.rs): il diario persistente delle modifiche per garantire che nessun dato vada perso in caso di arresto improvviso.

---

## Se vuoi il dettaglio

- Guarda [`docs/01-concetti/02-il-kernel.md`](../01-concetti/02-il-kernel.md) per una spiegazione intuitiva con analogie.
