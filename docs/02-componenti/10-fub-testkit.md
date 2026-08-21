# `fub-testkit` — Strumenti per i test del lato host

Per chi è: sviluppatori e studenti che vogliono capire come vengono collaudate in modo automatico le funzioni di Fub senza avviare la finestra grafica.

---

## A cosa serve

[`crates/fub-testkit`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-testkit) è una libreria di supporto per i test di integrazione (*end-to-end*).

Permette di:
- Creare rapidamente un vault temporaneo su disco con file `.md` e cartella `.fub/`.
- Inizializzare un `Workspace` vero con tutti i provider montati.
- Raccogliere e verificare la sequenza degli eventi emessi durante una serie di operazioni (scritture, modifiche, ricerche).

---

## Dipendenze

- **Dipendenze interne**: dipende da [`fub-abi`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi) e [`fub-kernel`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-kernel).
- **Invariante fondamentale**: `fub-testkit` **non è mai una dipendenza normale di nessun crate**. Viene dichiarato esclusivamente sotto `[dev-dependencies]` per evitare che codice di test finisca nell'applicazione finale.

---

## File chiave del modulo

- [`crates/fub-testkit/src/lib.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-testkit/src/lib.rs): esporta `TestVault` e `RecordingSink` per registrare gli eventi emessi.
- [`crates/fub-testkit/src/harness.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-testkit/src/harness.rs): ambiente di test automatizzato per montare scenari complessi in pochi comandi.

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-host/tests/concurrency.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-host/tests/concurrency.rs) per un esempio pratico di test che usa `fub-testkit`.
