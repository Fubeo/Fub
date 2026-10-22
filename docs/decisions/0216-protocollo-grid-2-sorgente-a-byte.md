# 0216 — Il protocollo `grid` 2 apre una sorgente a byte nella custodia dell'host, e la modifica è un giornale di celle

- **Stato:** accolta
- **Data:** 2026-10-22
- **Ambito:** contratto
- **Sostituisce:** 0214, per l'apertura della cartella di Excel come proiezione
- **Sostituita da:** —

## Contesto

La [0214](0214-gridcraft-motore-del-foglio-di-calcolo.md) apriva una cartella
di Excel in sola lettura, come proiezione JSON di tutta la cartella con un
tetto di 16 MiB e di 262.144 righe e colonne; il protocollo `grid` della
[0201](0201-superfici-strutturate-a-finestre.md) restava per i sorgenti di
testo. Il primo caso di modifica è cambiare il **valore** delle celle, senza
operazioni strutturali, che vivono nella facciata di GridCraft
(storytold/gridcraft#2136). Quattro vincoli decidono la forma:

- il buffer della `DocumentSession` è testo, e su quel testo lavorano coda di
  salvataggio, bozze, conflitti, rinomina e cestino;
- i byte non toccati restano i byte del file, e i valori salvati delle celle
  non toccate non si ricalcolano mai;
- un foglio grande si legge per finestre;
- un contratto `grid` nasce con un consumatore nativo e uno WASM (0201).

## Decisione

### Il binding e la sorgente

- **Versione 2 della famiglia `grid`** (`protocol_version = 2`,
  `GridSurfaceSpec::bytes`); la versione 1 resta com'è. La shell monta la
  versione 2 soltanto per un documento il cui testo è un giornale.
- **La sorgente è a byte e resta nell'host.** La shell apre una sessione con
  il documento, il giornale della sua `DocumentSession` e la revisione su cui
  lavora; l'host legge i byte, controlla che `Revision::of_bytes` sia quella
  (altrimenti è un conflitto) e li passa al provider. I byte non attraversano
  mai l'IPC. Il limite è `MAX_GRID_BYTES_SOURCE`, 256 MiB.
- **Il contratto WASM è l'interfaccia nuova `grid-bytes`**: `surfaces`,
  `open`, `window`, `apply`, `bytes-to-write`, `close`, `shutdown`. Un
  componente che esporta soltanto `grid` resta valido.

### Il testo del documento è un giornale di celle

- `read_document` dice che cosa è il testo con `text_kind`: `source`, o
  `grid_journal` per una cartella, di cui dà il giornale vuoto (il testo
  vuoto) con la revisione dei byte.
- Il **giornale** (`fub_abi::GridJournal`) ha una voce per cella cambiata
  rispetto ai byte: la coordinata stabile (`SheetId + RowId + ColumnId`),
  l'input nel file (`before`) e quello nuovo (`after`).
- **La forma canonica è una sola**: JSON chiuso e versionato, voci in ordine
  di coordinata confrontata come byte, id di ASCII stampabile, nessuna voce con
  `after` uguale a `before`. La regola è di `fub-abi`; la shell ne ha il mirror
  (`state/grid-journal.ts`), legato dalla fixture `GridJournalRebase`.
- **Dopo un salvataggio la `DocumentSession` ribasa il giornale**: le voci
  salvate e non più toccate escono, quelle cambiate nel frattempo restano con
  il `before` scritto dal salvataggio. Una bozza è il giornale con la sua base.

### La sessione del provider

- `open(surface, source, revision, journal)` apre la sessione con il giornale
  applicato: fogli, foglio attivo, fogli nascosti, avvisi in codici chiusi e
  voci in conflitto (la cella ha nei byte un terzo input).
- `window` è quella della versione 1, con celle che portano anche il testo
  formattato dal provider, il codice del blocco (`lock`), `stale` (il valore
  del file non segue una cella cambiata) e `conflict`.
- `apply` riceve le patch della versione 1, con la preimmagine controllata su
  ciò che la cella mostra; il `GridCommit` porta il diff **del testo del
  giornale**, che la shell applica al buffer come ogni diff, e l'invalidazione.
  Le dipendenti non si ricalcolano. Riportare una cella all'input dei byte
  toglie la voce: così l'annulla rimette una formula su cui si era scritto.
- `bytes-to-write(instance, expected)` dà i byte con il giornale innestato, e
  la chiama soltanto l'host.

La shell (`editors/grid/engine.ts`) applica il giornale subito e lo corregge
con l'esito del provider quando la coda è vuota; un rifiuto tipizzato torna
indietro e si dice nell'avviso della griglia.

### Il salvataggio

`write_document` di un giornale è un **salvataggio dell'host**, indipendente
dalle superfici aperte. Nel turno di scrittura l'host legge i byte, controlla
la base (CAS), apre una sessione del provider registrato con il giornale,
chiede `bytes-to-write`, chiude la sessione anche se l'innesto fallisce e
scrive con il CAS della stessa revisione. Un giornale vuoto, o già nei byte,
non scrive niente. Una voce in conflitto scrive il suo input, perché la base
dice che la shell l'ha mostrata su quei byte; una voce che i byte non possono
ricevere (foglio sparito, cella bloccata) è un errore tipizzato, e il file
resta com'era. Una cartella esistente cambia soltanto per innesto:
`resource_write` la crea ma non la copre.

### La cartella di Excel

Il provider nativo è `XlsxGridProvider` di `fub-format-xlsx`:

- **Si cambiano soltanto valori costanti**: numero, testo, booleano o cella
  vuota. Un input `=…` è rifiutato finché il calcolo non entra con la sua
  decisione. Scrivere su una formula la toglie, come in Excel.
- **Niente si calcola all'apertura**: ogni valore è quello salvato nel file,
  compresi i versati delle matrici. La proiezione della 0214 è ritirata.
- **Le celle che non si toccano sono bloccate già nella finestra**: matrici e
  aree versate, l'origine di una formula condivisa, tabelle di dati,
  intestazioni e totali di una tabella, celle unite oltre la prima, pivot,
  valori ricchi, fogli protetti, e i fogli la cui forma l'innesto non sa
  ancora riscrivere.
- **L'innesto è a livello di riga.** Ogni voce dello zip non toccata si copia
  così com'è, compressione e ordine compresi; nei fogli non toccati non cambia
  un byte. In un foglio toccato le righe non toccate restano i loro byte, e in
  una riga toccata ogni cella non toccata resta i suoi; la cella toccata tiene
  il suo stile (`s`). Un testo nuovo è una stringa in linea, e la tabella delle
  stringhe condivise non cambia.
- **Niente si ricalcola, e il file lo dice**: se il giornale tocca una cella
  che una formula legge, o toglie una formula, l'innesto imposta
  `fullCalcOnLoad`; togliendo una formula esce anche la catena di calcolo, che
  Excel ricostruisce.
- **La rilettura prova l'innesto**: ogni cella non toccata ha lo stesso input,
  valore salvato e stile, ogni cella toccata il valore voluto; altrimenti è un
  errore tipizzato, e i byte restano quelli.

### Il secondo consumatore e i limiti

`esempi/grid-wasm` serve anche la versione 2: ogni riga di un sorgente UTF-8 è
una cella, e `bytes-to-write` innesta le righe cambiate. Nativo e WASM passano
`fub_sdk::testing::conformance::a_grid_bytes_provider_supports_the_lifecycle`.
Oltre ai limiti della 0201, la versione 2 ha la sorgente fino a 256 MiB, il
giornale fino a 16.384 voci e 4 MiB di input, id di 64 byte e 64 avvisi per
sessione.

## Conseguenze

### Positive

- Una cartella di Excel si modifica nei valori senza che il resto del file
  cambi di un byte, e senza che un valore non toccato si ricalcoli.
- La shell legge soltanto le finestre che mostra: il tetto della proiezione
  non vale più.
- Salvataggio, bozze, conflitti, rinomina e cestino restano quelli della
  `DocumentSession`, su un testo piccolo.

### Negative

- Una forma pubblica nuova in `fub-abi`, WIT, IPC e mirror, con un secondo
  consumatore da tenere, e la regola del giornale in Rust e in TypeScript.
- Le dipendenti di una cella cambiata mostrano il valore del file finché la
  cartella non si riapre in Excel o il calcolo non entra.
- Formule, operazioni strutturali, formattazione condizionale, tabelle e
  pivot non si modificano.

## Alternative scartate

- **La proiezione della 0214, innestata al salvataggio.** La shell terrebbe
  tutta la cartella, e ogni cartella oltre il tetto resterebbe in sola lettura.
- **I byte nel buffer della shell.** Ogni salvataggio e ogni bozza porterebbero
  il file intero attraverso l'IPC, in un buffer binario.
- **Il codec di GridCraft per scrivere.** Riscrive dal modello: ciò che il
  modello non conosce cambierebbe a ogni salvataggio.
- **Ricalcolare le dipendenti.** Darebbe valori diversi da Excel dove il motore
  differisce, e toccherebbe celle che l'utente non ha toccato.

## Verifica

- `crates/fub-abi`: forma canonica e ribasamento del giornale, limiti,
  additività del WIT;
- `crates/fub-format-xlsx/tests/`: `graft.rs` (l'innesto, e con `FUB_SOFFICE`
  la rilettura di LibreOffice), `grid.rs`, `display.rs`, `ts_grid.rs`;
- `crates/fub-kernel/tests/grid_bytes.rs` e
  `crates/fub-wasm-host/tests/grid_bytes_crosses.rs`;
- `crates/fub-host/tests/xlsx_workbooks.rs`: giornale, apertura sui byte,
  salvataggio, CAS e rifiuti;
- `apps/client`: mirror del giornale, `DocumentSession` a giornale, motore
  della griglia e scena `grid-workbook` del banco.
