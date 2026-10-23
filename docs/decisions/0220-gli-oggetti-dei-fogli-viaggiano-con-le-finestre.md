# 0220 — Gli oggetti dei fogli viaggiano con le finestre, e i grafici arrivano disegnati

- **Stato:** proposta
- **Data:** 2026-10-23
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Con l'[ADR 0219](0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md)
una cartella di Excel si modifica con i comandi di GridCraft. Grafici,
grafici sparkline, immagini e forme restavano però fuori dalla griglia: la
sessione li contava negli avvisi `not-shown-*`, e un comando che li
inseriva cambiava il file senza che la shell li mostrasse.

Un oggetto galleggia sulle celle, ancorato a una cella con uno scarto e una
misura. Un grafico è un modello ricco (serie, assi, legende, stili) che
GridCraft sa già disegnare; un'immagine sono byte del pacchetto, che possono
pesare megabyte e ripetersi in più fogli; una forma è un aspetto semplice
(figura, colori, testo). La shell non deve ricevere codice eseguibile, e il
provider non deve diventare un secondo disegnatore di forme.

## Decisione

- Gli oggetti arrivano con la finestra che toccano (`GridObject` nel
  `GridBytesWindow`, nel record WIT e nel mirror), nell'ordine in cui si
  disegnano: nessuna porta nuova. Ogni oggetto porta tipo, id del file,
  cella dell'angolo, scarto e misura in pixel a zoom 100 e testo
  alternativo.
- **Un grafico o un grafico sparkline arriva disegnato in SVG** dal
  provider, con il disegnatore di `gridcraft-chart` (patch `0009`), che
  diventa una dipendenza diretta dell'adattatore e una riga di
  `GRIDCRAFT_OWNERS`. La shell lo
  mostra in un `<img>` con un indirizzo `data:`, dove un SVG non esegue
  niente e non legge la pagina.
- **Un'immagine arriva con la sua impronta** (i primi 16 byte di SHA-256 in
  esadecimale) e i byte in base64, una volta sola: la richiesta della
  finestra elenca in `known_media` le impronte che la shell ha già, e di
  quelle la finestra porta soltanto la chiave. Passano soltanto PNG, JPEG,
  GIF, BMP, WebP e SVG; un altro tipo arriva come `unsupported`.
- **Una forma arriva come aspetto tipato** (`GridShape`: figura, colori
  risolti in `#RRGGBB`, testo, carattere, allineamento), e la disegna la
  shell.
- Limiti nel contratto: 1.024 oggetti per finestra, 1 MiB di SVG per
  grafico, 3 MiB di base64 per immagine, 64 KiB di testo per forma, 256
  impronte di 64 byte nella richiesta. Una finestra non porta oltre 2 MiB di
  SVG e 4 MiB di immagini: ciò che non ci sta arriva come `too_large`
  (l'oggetto) o senza byte (l'immagine, che una finestra dopo riporta).
- Spostare, misurare, cancellare e scrivere il testo di un oggetto sono
  comandi del catalogo (`object.move`, `object.delete`, `shape.setText`…),
  come ogni altra modifica: il giornale li rifà e l'annulla li toglie.

## Conseguenze

### Positive

- I grafici della shell sono quelli di GridCraft, senza un secondo motore di
  grafici in TypeScript.
- Un'immagine ripetuta attraversa l'IPC una volta per sessione.
- Il contratto resta tipato: nessun DOM, nessuno script, nessun JSON
  libero per gli oggetti.

### Negative

- Una finestra con molti grafici pesa più di prima, e lo scorrimento
  rilegge gli oggetti che la nuova finestra tocca.
- Un grafico non si anima e non risponde al puntatore dentro di sé: si
  seleziona intero.
- Un'immagine piccola ingrandita si sfoca come il file la disegna.

## Alternative scartate

### Una porta per gli oggetti

Una `grid_bytes_objects` separata avrebbe tenuto leggere le finestre, ma la
shell avrebbe dovuto accordare due letture sulla stessa revisione, e
l'invalidazione di un comando avrebbe toccato due cache.

### I grafici disegnati dalla shell

Mandare il modello del grafico e disegnarlo in TypeScript avrebbe
duplicato il disegnatore di GridCraft, con due risultati diversi dello
stesso file.

### Le immagini come risorse del vault

Il resource host serve file del vault per percorso; un'immagine sta dentro
il pacchetto della cartella, e non ha un percorso. Darle un indirizzo
avrebbe chiesto un secondo custode dei byte del file.

## Verifica

- `crates/fub-format-xlsx/tests/objects.rs`: oggetti di file veri, ordine,
  ancore, impronte, `known_media`, limiti e tipi rifiutati; una casella di
  testo inserita, scritta e spostata che il giornale rifà e il file salvato
  conserva.
- `crates/fub-abi/tests/wit_conformance.rs` e
  `crates/fub-wasm-host/tests/grid_bytes_crosses.rs`: parità Rust, WIT e
  WASM.
- `crates/fub-format-xlsx/tests/ts_grid.rs` e
  `apps/client/src/__fixtures__/xlsx-grid.json`: la forma che la shell legge.
- `apps/client/src/editors/grid/workbook.test.ts`,
  `objects.test.ts` ed `engine.test.ts`: validazione della finestra, cache
  delle immagini, disegno, selezione, tastiera e `object.move`.
