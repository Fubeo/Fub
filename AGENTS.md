# Repository guidelines

## Prima di modificare il repository

Leggi:

1. [`CONTRIBUTING.md`](CONTRIBUTING.md) per il ciclo locale;
2. [`docs/architecture/overview.md`](docs/architecture/overview.md) per i confini;
3. la pagina canonica dell'area modificata;
4. un ADR soltanto quando serve capire il perché di una scelta.

Il codice e i test hanno precedenza sulla prosa. WIT, schemi persistenti e tipi
IPC sono contratti pubblici: non cambiarli come dettagli locali.

## Confini da preservare

- `fub-abi` contiene tipi, trait, errori, regole, WIT e rappresentazioni IPC.
- `fub-kernel` possiede workspace, storage, indici, policy ed eventi. Non deve
  conoscere Tauri, Wasmtime o Markdown.
- `fub-host` compone sessioni, bundle, watcher, impostazioni e job. Non deve
  conoscere Tauri.
- `fub-app` contiene il binario Tauri e adattatori IPC sottili.
- `fub-format-markdown` è l'unico crate che conosce Markdown.
- `fub-wasm-host` è l'unico crate che dipende da Wasmtime.
- `apps/client/src/host/` è il seam della shell. Soltanto `host/ipc.ts` e
  `host/dialog.ts` possono importare API Tauri.
- `fub-testkit` è una dipendenza di sviluppo, non una dipendenza normale.

Preferisci le porte generiche già presenti:

- `query_index` per i dati;
- `list_commands` e `invoke_command` per le azioni;
- `list_views`, `render_view` e `view_action` per le view;
- porte esplicite soltanto per scritture e bozze.

## Regole operative

- I tipi condivisi nascono in `fub-abi` e, se attraversano il confine WASM,
  hanno una proiezione WIT coerente.
- Gli interi `u64` attraversano l'IPC come stringhe.
- Non tenere lock durante una chiamata a un provider.
- Gli eventi restano accodati e non rientranti.
- Gli errori attraversano i confini come varianti tipizzate, non come
  `error.to_string()`.
- Usa `fub-sdk::testing::MemoryHost` per i test di provider e
  `fub-testkit::{Bench, Mounted}` per integrazioni host/kernel.
- I file generati si modificano attraverso la sorgente e il generatore.
- Una specifica futura diventa una issue; non creare piani permanenti in
  `docs/`.

## Verifica

Esegui il ciclo pertinente descritto in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Per una modifica trasversale, termina con
i test Rust, il type-check/test/build del frontend e i guard documentali.
