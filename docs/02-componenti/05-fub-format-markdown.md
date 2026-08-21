# `fub-format-markdown` — Il provider Markdown nativo

## A cosa serve

[`crates/fub-format-markdown`](../../crates/fub-format-markdown) è il modulo che implementa il trait `FormatProvider` per i file con estensione `.md`.

Il suo compito è triplice:
1. **Analisi (Parsing)**: legge il testo grezzo e, usando la libreria `comrak`, costruisce l'albero `DocumentModel` (titoli, paragrafi, elenchi, wikilink `[[nota]]`, tag `#tag`).
2. **Visualizzazione (Rendering)**: trasforma il modello in HTML sicuro per la visualizzazione nell'anteprima.
3. **Scrittura (Serializzazione)**: riconverte un modello modificato nel testo Markdown originale senza alterare la formattazione dell'utente.

---

## Dipendenze

- **Dipendenze interne**: dipende da [`fub-abi`](../../crates/fub-abi) e [`fub-sdk`](../../crates/fub-sdk).
- **Dipendenze esterne**: `comrak` (il motore di parsing Markdown), `serde_yaml_ng` (per leggere il frontmatter YAML all'inizio dei file).
- **Invariante**: la libreria `comrak` è utilizzata **esclusivamente qui dentro** e non compare in nessun altro punto del progetto.

---

## File chiave del modulo

- [`crates/fub-format-markdown/src/lib.rs`](../../crates/fub-format-markdown/src/lib.rs): esporta il `MarkdownProvider`.
- [`crates/fub-format-markdown/src/parse.rs`](../../crates/fub-format-markdown/src/parse.rs): converte i nodi dell'albero di comrak nei nodi del modello Fub (`Block` e `Inline`).
- [`crates/fub-format-markdown/src/render.rs`](../../crates/fub-format-markdown/src/render.rs): genera l'HTML da visualizzare nell'anteprima live.
- [`crates/fub-format-markdown/src/serialize.rs`](../../crates/fub-format-markdown/src/serialize.rs): riscrittura del modello in testo Markdown.

---

## Se vuoi il dettaglio

- Guarda [`docs/05-disco/01-note-utente.md`](../05-disco/01-note-utente.md) per conoscere le estensioni Markdown supportate.
