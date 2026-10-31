# 0228 — `~x~` è pedice, `~~x~~` barrato

- **Stato:** proposta
- **Data:** 2026-10-29
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La Live leggeva già `~x~` come pedice, con la grammatica Lezer del client, e
lo mostrava abbassato. Il provider Markdown no: comrak, con la sola estensione
del barrato, leggeva `~x~` come barrato. Lettura e Live dicevano una cosa,
stampa, export, ricerca e modello un'altra, e una nota salvata da un provider
che riscrive il modello poteva trasformare un pedice in un barrato. Il modello
condiviso (`fub_abi::model::Inline`) aveva l'apice ma non il pedice.

Le convenzioni in giro non sono una sola: GitHub legge `~x~` come barrato,
Pandoc e molti editor di note come pedice. Fub doveva sceglierne una e dirla
in tutti i lati.

## Decisione

1. **Una tilde è pedice, due sono barrato**, in ogni lato: grammatica del
   client, provider (`extension.subscript` di comrak), resa, serializzazione e
   corpus condiviso.
2. **Il pedice è una variante del modello.** `Inline::Subscript` entra in coda
   all'enum di `fub-abi`, e `subscript(list<inline-ref>)` in coda a
   `variant inline` del WIT `fub:abi@0.2.0`, che non ha ancora una fotografia
   congelata. Chi legge il modello tratta il pedice come tratta l'apice.
3. **La serializzazione scrive `~…~`.** Un pedice letto da un file torna nel
   file con gli stessi segni.

## Conseguenze

### Positive

- Live, Lettura, stampa, export, ricerca e modello leggono `~x~` allo stesso
  modo;
- il pedice ha un pulsante e una forma nel modello, come l'apice.

### Negative

- una nota scritta per GitHub con `~x~` come barrato in Fub si legge come
  pedice; `~~x~~` è la forma che vale ovunque;
- i componenti WASM compilati prima della variante non la conoscono.

## Alternative scartate

### `~x~` barrato come GitHub

Era la lettura del provider, ma la Live e la barra mostravano già il pedice, e
il pedice non avrebbe avuto un segno suo: restava soltanto `<sub>`.

### Pedice soltanto nel client

Lasciava il modello senza pedice: stampa, export e ricerca continuavano a
dirlo barrato.

## Verifica

- `crates/fub-format-markdown/tests/superscript_and_strikethrough.rs`: una
  tilde è pedice, due sono barrato, e il file torna uguale;
- il caso «pedice» del corpus (`tests/corpus/mod.rs`), che
  `apps/client/src/editors/text/profiles/markdown/corpus.test.ts` confronta con
  gli stili della grammatica del client;
- `crates/fub-abi/tests/wit_conformance.rs` e il round trip del modello.
