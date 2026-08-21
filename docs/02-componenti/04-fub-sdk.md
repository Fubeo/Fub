# `fub-sdk` — Kit di sviluppo per plugin

## A cosa serve

[`crates/fub-sdk`](../../crates/fub-sdk) raccoglie funzioni e strutture di supporto che rendono facile e veloce scrivere un plugin per Fub.

Fornisce:
- Costruttori rapidi per creare elementi grafici dichiarativi (`UiNode`).
- Funzioni di test di conformità per verificare che un provider rispetti le regole del contratto.
- Un ambiente di simulazione in memoria (`MemoryHost`) per testare i plugin senza dover accedere al disco reale.

---

## Dipendenze

- **Dipendenze interne**: dipende unicamente da [`fub-abi`](../../crates/fub-abi).
- **Invariante fondamentale**: `fub-sdk` **non dipende e non vedrà mai `fub-kernel`**. Questo garantisce che chi scrive un plugin non possa accidentalmente legarsi ai dettagli interni del motore.

---

## File chiave del modulo

- [`crates/fub-sdk/src/ui.rs`](../../crates/fub-sdk/src/ui.rs): funzioni helper per costruire alberi di interfaccia grafica (pulsanti, tabelle, testi, layout).
- [`crates/fub-sdk/src/testing/mod.rs`](../../crates/fub-sdk/src/testing/mod.rs): simulatore host in memoria per i test di conformità.tizia dell'interfaccia `HostApi` utile per collaudi rapidi nei test unitari.
- [`crates/fub-sdk/src/testing/conformance.rs`](../../crates/fub-sdk/src/testing/conformance.rs): suite di test automatizzati per validare che un provider implementi correttamente tutti i metodi richiesti.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/`](../04-plugin) per imparare a costruire un plugin completo passo dopo passo.
