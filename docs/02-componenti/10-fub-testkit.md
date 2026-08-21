# `fub-testkit` — Strumenti per i test del lato host

Per chi è: sviluppatori e studenti che vogliono capire come vengono collaudate in modo automatico le funzioni di Fub senza avviare la finestra grafica.

---

## A cosa serve

[`crates/fub-testkit`](../../crates/fub-testkit) è una libreria di supporto per i test di integrazione (*end-to-end*).

Permette di:
- Creare rapidamente un vault temporaneo su disco con file `.md` e cartella `.fub/`.
- Inizializzare un `Workspace` vero con tutti i provider montati.
- Raccogliere e verificare la sequenza degli eventi emessi durante una serie di operazioni (scritture, modifiche, ricerche).

---

## Dipendenze

- **Dipendenze interne**: dipende da [`fub-abi`](../../crates/fub-abi) e [`fub-kernel`](../../crates/fub-kernel).
- **Invariante fondamentale**: `fub-testkit` **non è mai una dipendenza normale di nessun crate**. Viene dichiarato esclusivamente sotto `[dev-dependencies]` per evitare che codice di test finisca nell'applicazione finale.

---

## File chiave del modulo

- [`crates/fub-testkit/src/lib.rs`](../../crates/fub-testkit/src/lib.rs): esporta `TestVault` e `RecordingSink` per registrare gli eventi emessi.
- [`crates/fub-testkit/src/format.rs`](../../crates/fub-testkit/src/format.rs): supporto per simulare e montare formati di test.

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-host/tests/concurrency.rs`](../../crates/fub-host/tests/concurrency.rs) per un esempio pratico di test che usa `fub-testkit`.
