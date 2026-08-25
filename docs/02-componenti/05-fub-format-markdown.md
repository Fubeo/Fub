# `fub-format-markdown` — il provider Markdown

[`crates/fub-format-markdown/`](../../crates/fub-format-markdown) è
l'implementazione nativa di `FormatProvider` per le estensioni `.md` e
`.markdown`. È il componente che conosce la sintassi Markdown; il kernel vede
soltanto il contratto comune.

## Responsabilità

- analizzare il testo con Comrak e produrre un `DocumentModel`;
- conservare gli span necessari a collegare il modello alla sorgente;
- estrarre frontmatter, titoli, collegamenti, tag e altre strutture supportate;
- generare l'HTML usato dall'anteprima;
- serializzare modelli nuovi o frammenti in Markdown;
- importare ed esportare documenti attraverso le superfici di trasferimento.

Il descrittore dichiara queste capacità native:

- wikilink;
- tag;
- frontmatter;
- callout;
- embed;
- note a piè di pagina;
- liste di definizione.

Regole sintattiche aggiunte da altri provider non diventano capacità native del
formato: appartengono al vault montato.

## Parsing e scrittura non sono simmetrici

Il parser produce un modello semantico, non una copia byte per byte della
sorgente. Informazioni come lo stile scelto per l'enfasi, alcune spaziature o
l'indentazione possono non essere rappresentate nel modello.

Di conseguenza, `serialize` **non promette un round-trip identico**. Genera
Markdown valido per documenti nuovi e frammenti. Le modifiche a un documento
esistente devono preferire patch mirate sulla sorgente guidate dagli span,
perché la sorgente sul disco resta autorevole.

Quando il provider incontra una struttura che non sa riscrivere, restituisce un
errore invece di cancellare silenziosamente delimitatori o contenuto.

## Moduli

| File | Responsabilità |
|---|---|
| [`lib.rs`](../../crates/fub-format-markdown/src/lib.rs) | `MarkdownProvider`, descrittore, capacità e implementazione di `FormatProvider`. |
| [`parse.rs`](../../crates/fub-format-markdown/src/parse.rs) | Conversione dal parser Comrak al modello comune. |
| [`offsets.rs`](../../crates/fub-format-markdown/src/offsets.rs) | Conversione e verifica degli offset della sorgente. |
| [`render.rs`](../../crates/fub-format-markdown/src/render.rs) | Resa HTML del modello. |
| [`serialize.rs`](../../crates/fub-format-markdown/src/serialize.rs) | Generazione del Markdown e rifiuto esplicito dei nodi non scrivibili. |
| [`transfer.rs`](../../crates/fub-format-markdown/src/transfer.rs) | Importazione ed esportazione di file Markdown. |
| [`util.rs`](../../crates/fub-format-markdown/src/util.rs) | Utility interne condivise. |

## Dipendenze

Il crate usa `comrak`, `entities`, `serde_yaml_ng`, `serde`, `serde_json`,
`fub-abi` e `fub-sdk`. Comrak non deve entrare nel kernel o nell'ABI.

Le convenzioni riconosciute nei file utente sono descritte in
[`../05-disco/01-note-utente.md`](../05-disco/01-note-utente.md).
