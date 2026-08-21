# `fub-features` — Le funzionalità ufficiali

Per chi è: studenti che vogliono capire come sono costruite le funzioni avanzate di Fub (ricerca, collegamenti, cronologia, cestino).

---

## A cosa serve

[`crates/fub-features`](../../crates/fub-features) raccoglie le estensioni integrate nel programma. Ognuna è scritta esattamente come se fosse un plugin esterno, usando i trait di `fub-abi`.

Include:
- **Ricerca rapida** (`search.rs`): basata sul motore di ricerca full-text `tantivy`.
- **Grafico e collegamenti** (`graph.rs`): mappa visiva e pannello dei backlink (collegamenti in entrata).
- **Gestione blocchi e sintassi** (`blocks.rs`): callout, tabelle, blocchi personalizzati.
- **Cronologia e versioning** (`versioning.rs`): salvataggio periodico di snapshot delle note.
- **Comandi globali** (`commands.rs`): azioni veloci da tastiera e menu.

---

## Dipendenze

- **Dipendenze interne**: dipende unicamente da [`fub-abi`](../../crates/fub-abi).
- **Invariante del dogfooding**: per garantire che il contratto sia sufficiente a scrivere qualsiasi funzione, `fub-features` **non dipende dal kernel** per il suo funzionamento normale (usa `fub-kernel` solo nei test automatizzati).
- **Dipendenze esterne**: `tantivy` (motore di ricerca full-text), `camino`, `serde`, `tracing`.

---

## File chiave del modulo

- [`crates/fub-features/src/inventory.rs`](../../crates/fub-features/src/inventory.rs): l'elenco e la registrazione di tutte le feature disponibili.
- [`crates/fub-features/src/search.rs`](../../crates/fub-features/src/search.rs): implementazione dell'indice `IndexProvider` tramite `tantivy`.
- [`crates/fub-features/src/graph.rs`](../../crates/fub-features/src/graph.rs): pannello per visualizzare la rete di relazioni tra le note del vault.
- [`crates/fub-features/src/versioning.rs`](../../crates/fub-features/src/versioning.rs): gestore degli snapshot di sicurezza per recuperare versioni precedenti dei file.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/01-nativo-vs-wasm.md`](../04-plugin/01-nativo-vs-wasm.md) per capire come queste feature fungono da modello per i plugin futuri.
