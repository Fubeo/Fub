# Il formato della lavagna

> **Ambito:** il nucleo della lavagna, `fub-canvas-core`: il modello di una
> `.canvas` (JSON Canvas 1.0) e le regole con cui Fub la legge e la scrive.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/`,
> `crates/fub-format-canvas/schema/canvas-v1.schema.json` e
> `crates/fub-abi/tests/dependency_invariant.rs`.

Una lavagna è un file `.canvas` nel formato [JSON Canvas
1.0](https://jsoncanvas.org/spec/1.0/), lo stesso di Obsidian: schede (`nodes`)
in ordine di profondità crescente, archi (`edges`) fra le schede, e qualunque
altro campo, che Fub conserva così com'è.

## Il nucleo

`fub-canvas-core` è il posto dove sta ciò che ogni parte di Fub fa con una
lavagna, scritto una volta sola:

- `model`: i tipi del modello (`Canvas`, `CanvasNode`, `CanvasEdge`, i colori,
  i lati e gli estremi degli archi), i limiti (`MAX_SOURCE_BYTES`,
  `MAX_NODES`, `MAX_EDGES`, …), l'errore `CanvasError` e `Canvas::validate`.
  Ogni livello (la radice, ogni scheda, ogni arco) tiene in `extra` i campi
  che il modello non conosce, `fub:ink` compreso.
- `read`: `parse(source)`, dal testo del file al modello validato.
- `js`, `source`, `patch`, `commit`, `ops`: la scrittura come la fa
  JavaScript, il ritocco del sorgente, le toppe con la loro inversa, il commit
  e le operazioni d'intento. Arrivano con i task successivi di N3.

Il nucleo è **puro**. Dipende soltanto da `serde`, `serde_json` e `thiserror`;
non vede il contratto (`fub-abi`), il Markdown, il kernel né un toolkit, non fa
I/O e compila per `wasm32-unknown-unknown`, perché la WebView lo carica come
modulo WebAssembly. Non va mai in panico su un input: ogni errore è un
`CanvasError`.

`serde_json` vi entra con la feature `float_roundtrip`, così un decimale si
rilegge esatto e non a meno dell'ultima cifra. Le feature di Cargo si
uniscono: dovunque ci sia il nucleo, ogni `serde_json` del grafo legge i
decimali così.

### Chi lo usa

L'elenco è chiuso, e `the_canvas_core_stands_alone` in
`crates/fub-abi/tests/dependency_invariant.rs` lo verifica insieme alle
dipendenze dirette:

| Cliente | Che cosa ne fa |
|---|---|
| `fub-format-canvas` | il provider del formato: riespone il modello e `parse_canvas` con la stessa API, e ci costruisce sopra `DocumentModel`, l'HTML statico e la riscrittura dei link. L'id del formato (`FORMAT_ID`) e la versione dello schema (`SCHEMA_VERSION`) restano suoi. |
| `fub-features` | ammesso per i comandi della lavagna (bundle `fub.lavagna`, feature `lavagna`), che arrivano con N3. |
| `fub-canvas-wasm` | ammesso per la facciata WebAssembly che la WebView caricherà, che arriva con N3. |

Oggi il solo cliente è `fub-format-canvas`. Aggiungere un cliente all'elenco è
una decisione: si scrive qui e poi nel test.

### Come si prova

- `cargo test -p fub-canvas-core` e `cargo test -p fub-format-canvas`;
- `cargo test -p fub-abi --test dependency_invariant`;
- `cargo check -p fub-canvas-core --target wasm32-unknown-unknown --locked`,
  nel giro completo di `scripts/check.sh` (saltato se il bersaglio non è
  installato).

## Lettura

Oggi `parse` fa ciò che faceva `parse_canvas` prima del nucleo: rifiuta un
sorgente oltre `MAX_SOURCE_BYTES`, legge come lavagna vuota un sorgente di
soli spazi, salta un BOM iniziale senza toglierlo dal file, e passa il modello
a `Canvas::validate`.

Le regole di lettura che Rust e TypeScript condividono sono ancora da
scrivere.

## Scrittura

Da scrivere.

## Parità

Da scrivere.
