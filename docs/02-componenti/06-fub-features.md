# `fub-features` — Le funzionalità ufficiali

## A cosa serve

[`crates/fub-features`](../../crates/fub-features) raccoglie l'insieme delle estensioni e dei pannelli integrati nel programma.

Ogni feature è scritta **esattamente come se fosse un plugin di terze parti**, implementando i trait del contratto comune definiti in [`fub-abi`](../../crates/fub-abi) (`ViewProvider`, `IndexProvider`, `CommandProvider`, `EventHandler`).

---

## Il principio del Dogfooding e Invarianti

1. **Nessuna dipendenza dal kernel in produzione**: `fub-features` **non dipende da `fub-kernel`**. Comunica unicamente tramite i trait di `fub-abi` e `HostApi`. Questo assicura che il contratto ABI sia espressivo e sufficiente per realizzare qualsiasi funzionalità avanzata.
2. **Modularità via Cargo Features**: ogni feature corrisponde a una cargo feature omonima nel `Cargo.toml`. È possibile compilare build parziali o minimali disattivando selettivamente i bundle (es. disattivando `search`, si esclude la dipendenza pesante `tantivy` riducendo il tempo di build).
3. **Inventario come unica sorgente di verità (`inventory.rs`)**: l'elenco delle feature montabili è definito come array statico in `inventory.rs`. Non esistono tabelle duplicate o registrazioni manuali sparse.

---

## Le 15 Feature Ufficiali

| Feature (ID Bundle) | Trait / Ruolo | Descrizione | File sorgente |
|---|---|---|---|
| **`search`** (`fub.search`) | `IndexProvider` | Motore di ricerca full-text incrementale basato su `tantivy`. Gestisce prefissi, fuzzy search e punteggi BM25. | [`src/search.rs`](../../crates/fub-features/src/search.rs) |
| **`graph`** (`fub.graph`) | `ViewProvider` | Mappa interattiva 2D delle connessioni tra note, con filtri per tag e percorsi. | [`src/graph.rs`](../../crates/fub-features/src/graph.rs) |
| **`backlinks`** (`fub.backlinks`) | `ViewProvider` | Pannello laterale che elenca tutti i collegamenti in entrata verso la nota correntemente aperta. | [`src/backlinks.rs`](../../crates/fub-features/src/backlinks.rs) |
| **`outline`** (`fub.outline`) | `ViewProvider` | Struttura gerarchica dei titoli (`Heading`) della nota attiva per la navigazione rapida. | [`src/outline.rs`](../../crates/fub-features/src/outline.rs) |
| **`tags`** (`fub.tags`) | `ViewProvider` | Esploratore ad albero di tutti i tag (`#tag`) presenti nel vault e relativi documenti associati. | [`src/tags.rs`](../../crates/fub-features/src/tags.rs) |
| **`properties`** (`fub.properties`) | `ViewProvider`, `CommandProvider` | Ispezione e modifica tabellare del frontmatter YAML delle note (`serde_yaml_ng`). | [`src/properties.rs`](../../crates/fub-features/src/properties.rs) |
| **`versioning`** (`fub.versioning`) | `ViewProvider`, `EventHandler` | Cronologia delle revisioni Copy-on-Write salvate sotto `.fub/data/plugins/fub.versioning/`. | [`src/versioning.rs`](../../crates/fub-features/src/versioning.rs) |
| **`trash`** (`fub.trash`) | `ViewProvider`, `CommandProvider` | Interfaccia per visualizzare note cancellate, ripristinarle (`trash.restore`) o svuotare il cestino (`trash.empty`). | [`src/trash.rs`](../../crates/fub-features/src/trash.rs) |
| **`commands`** (`fub.commands`) | `CommandProvider` | Registro delle azioni e scorciatoie globali da tastiera (`CoreCommands`). | [`src/commands.rs`](../../crates/fub-features/src/commands.rs) |
| **`blocks`** (`fub.blocks`) | `FormatProvider` helper | Regole e decorazioni per callout, tabelle avanzate, blocchi matematici ed embed. | [`src/blocks.rs`](../../crates/fub-features/src/blocks.rs) |
| **`template`** (`fub.template`) | `CommandProvider` | Gestione e inserimento rapido di modelli predefiniti per nuove note. | [`src/template.rs`](../../crates/fub-features/src/template.rs) |
| **`queries`** (`fub.queries`) | `ViewProvider`, `CommandProvider` | Esecuzione e salvataggio di viste filtrate e query strutturate. | [`src/queries.rs`](../../crates/fub-features/src/queries.rs) |
| **`dashboard`** (`fub.dashboard`) | `ViewProvider` | Panoramica generale del vault con stato di salute e collegamenti rapidi. | [`src/dashboard.rs`](../../crates/fub-features/src/dashboard.rs) |
| **`stats`** (`fub.stats`) | `ViewProvider` | Statistiche testuali: conteggio parole, caratteri, tempo di lettura stimato e densità link. | [`src/stats.rs`](../../crates/fub-features/src/stats.rs) |
| **`backup`** (`fub.backup`) | `ViewProvider`, `CommandProvider` | Strumenti di esportazione e snapshot di sicurezza dell'intero vault. | [`src/backup.rs`](../../crates/fub-features/src/backup.rs) |

---

## Dipendenze del Crate

- **Dipendenze interne**: [`fub-abi`](../../crates/fub-abi).
- **Dipendenze esterne**:
  - `tantivy` (motore di indicizzazione e ricerca full-text, abilitato dalla feature `search`).
  - `serde_yaml_ng` (lettura e riscrittura del frontmatter, abilitato dalla feature `properties`).
  - `camino` (gestione sicura dei percorsi UTF-8).
  - `serde`, `serde_json` (serializzazione dei messaggi e dati di stato).
  - `tracing` (logging diagnostico).
- **Dev-dependencies (solo per i test)**: `fub-kernel`, `fub-sdk`, `fub-testkit`, `fub-format-markdown`, `tempfile`.

---

## File chiave del modulo

- [`crates/fub-features/src/inventory.rs`](../../crates/fub-features/src/inventory.rs): l'anagrafe autorevole che elenca ogni feature, il rispettivo catalogo stringhe (`StringCatalog`) e la funzione costruttrice dei provider.
- [`crates/fub-features/src/search.rs`](../../crates/fub-features/src/search.rs): implementazione dell'indice `IndexProvider` basato su Tantivy.
- [`crates/fub-features/src/graph.rs`](../../crates/fub-features/src/graph.rs): logica e nodi dichiarativi per la mappa relazionale.
- [`crates/fub-features/src/versioning.rs`](../../crates/fub-features/src/versioning.rs): gestione snapshot storici su eventi di modifica.
- [`crates/fub-features/src/trash.rs`](../../crates/fub-features/src/trash.rs): gestione sidecar e ripristino file eliminati.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/01-nativo-vs-wasm.md`](../04-plugin/01-nativo-vs-wasm.md) per comprendere la differenza tra plugin nativi in-process e plugin isolati WASM.
- Guarda [`docs/03-uml/01-trait-fub-abi.md`](../03-uml/01-trait-fub-abi.md) per i dettagli su come i trait (`ViewProvider`, `IndexProvider`, ecc.) sono strutturati.
