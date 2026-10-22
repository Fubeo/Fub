# 0214 — GridCraft è il motore del foglio di calcolo, e una cartella di Excel si apre in sola lettura

- **Stato:** accolta
- **Data:** 2026-10-21
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** 0216, per l'apertura della cartella come proiezione

## Contesto

Fub ha un foglio suo, `.fubsheet`, con un modello e un motore di calcolo suoi
(`fub-format-sheet`), e il contratto `grid` della
[0201](0201-superfici-strutturate-a-finestre.md): sessioni, finestre e patch a
coordinate stabili su una sorgente di **testo**. Un `.xlsx` non si apriva.

Calcolare le formule di una cartella di Excel con il motore di `.fubsheet`
darebbe una semantica che non è quella di Excel, e tenere due modelli e due
motori accanto raddoppierebbe ciò che va corretto. GridCraft ha già i crate
del dominio: il modello della cartella, le formule e le funzioni con la
semantica di Excel, il calcolo e il codec XLSX. Sopra ha una facciata
applicativa (`engine`) con sessione, comandi, cronologia e selezione, che in
Fub sono della `DocumentSession` e della shell.

Prima di impegnarsi, il motore è stato provato sui punti che decidono:

- la logica delle operazioni strutturali (inserire e togliere righe e colonne,
  riscrivere le formule), della formattazione condizionale, delle tabelle e
  delle tabelle pivot vive soltanto nella facciata;
- il lettore scarta di proposito i valori in cache delle celle versate dalle
  matrici, dinamiche e legacy, perché il calcolo le riempia di nuovo;
- l'upstream dichiara Rust 1.90 ma ne chiede 1.94, e usa `zip` 3, che ha tre
  avvisi di sicurezza;
- i sette crate del dominio vietano `unsafe` e non portano nessuna libreria
  nuova nell'albero di Fub.

## Decisione

- **GridCraft è il motore del dominio del foglio di calcolo.** Entra con i
  crate del dominio (`core`, `formula`, `functions`, `numfmt`, `model`,
  `calc`, `xlsx`), copiati in `vendor/gridcraft/` come vuole la
  [0213](0213-provenienza-dei-motori-esterni.md), con un solo proprietario:
  `fub-format-xlsx`. La sola lettura usa `core`, `model`, `numfmt` e `xlsx`;
  `calc` e `functions` sono copiati per la modifica, e li provano soltanto i
  test della copia. La facciata, l'interfaccia, i grafici, il PDF e il server
  MCP dell'upstream non entrano.
- **Un solo motore per tipo di documento.** `.xlsx` → GridCraft; `.fubsheet` →
  il motore di `fub-format-sheet`, finché esiste. `.fubsheet` diventa un
  formato legacy: i file degli utenti restano leggibili e scrivibili come
  ora, senza cancellazioni né riscritture per tentativi, e il passaggio a
  `.xlsx` sarà una conversione esplicita che dice cosa non porta. Il contratto
  `grid` e l'esempio `esempi/grid-wasm` sono generici e restano.
- **Una cartella di Excel si apre in sola lettura, come proiezione.** Come i
  documenti di videoscrittura della [0209](0209-videoscrittura-come-proiezione.md),
  `read_document` dà in `text` una proiezione JSON chiusa e versionata della
  cartella, con i valori già nel formato numerico di ogni cella, e la shell la
  mostra nella famiglia `grid` (profilo `workbook`). `write_document` la
  rifiuta sempre: il codec riscriverebbe il file dal suo modello, e ciò che
  quel modello non conosce andrebbe perso. La proiezione dice cosa non mostra
  e cosa non fa (macro, collegamenti esterni, parti non disegnate, avvisi della
  lettura, formule senza valore, celle oltre i limiti).
- **Il contratto `grid` non cambia.** La sola lettura non ha patch da
  applicare né finestre da chiedere: un protocollo a byte, una versione 2 del
  contratto o una porta nuova sarebbero forme pubbliche senza un caso che le
  dimostri. Quando una cartella diventerà modificabile, il modo di
  modificarla si decide con quel caso davanti.
- **I valori sono quelli del file, e niente si ricalcola.** Ogni valore è
  quello che il file ha salvato, comprese le celle versate dalle matrici: la
  patch `0003` di `vendor/gridcraft` le tiene nella mappa dei valori versati
  invece di scartarle (storytold/gridcraft#2137). Una formula salvata senza
  valore mostra la formula e una cella vuota, e la proiezione lo dice. Così
  aprire una cartella costa la sua lettura, qualunque formula contenga.
- **Il codice di terzi non blocca l'host.** Il codec gira fuori dal lucchetto
  del workspace, in un thread con uno stack suo, con un limite sul file
  (256 MiB) e sulla proiezione: 16 MiB e 262.144 righe e colonne in tutto,
  perché la griglia tiene una voce per ognuna. Un suo panic diventa un errore
  tipizzato.
- **Ciò che vive nella facciata si chiede all'upstream.** Finché le operazioni
  strutturali, la formattazione condizionale, le tabelle e le pivot restano in
  `engine`, la modifica di una cartella non le usa.

## Conseguenze

### Positive

- Una cartella di Excel si apre, si cerca e ha un'anteprima, con i valori e
  l'aspetto che il file ha salvato.
- Il file non si tocca: nessun salvataggio può perdere ciò che il modello del
  motore non conosce.
- Il motore di `.fubsheet` non impara la semantica di Excel, e quello di
  Excel non entra nei fogli di Fub.

### Negative

- Una cartella non si modifica, e la griglia non disegna celle unite,
  grafici, immagini, forme, commenti, formattazione condizionale e
  sparkline: la proiezione le nomina soltanto.
- Fino alla conversione esplicita convivono due formati di foglio con due
  motori.
- Il codice di GridCraft ha le stesse condizioni di quello di WordCraft: due
  patch da tenere finché l'upstream non le assorbe, e i suoi difetti si
  leggono nelle note di versione.

## Alternative scartate

### GridCraft soltanto come codec, con il modello e il calcolo di Fub

Era la prima stesura del piano: due modelli accanto, e le formule di un
`.xlsx` calcolate con una semantica che non è quella di Excel.

### La cartella come provider del protocollo `grid`

Il contratto `grid` apre una sessione su una sorgente di testo. Una cartella
è a byte: servirebbe una versione del contratto, con le sue forme in `fub-abi`
e in WIT, per una superficie che non applica patch. La proiezione dell'host
passa dalle porte che ci sono, come la videoscrittura.

### Ricalcolare tutta la cartella all'apertura

Mostrerebbe valori che il file non ha, diversi da quelli di Excel ogni volta
che una funzione volatile, un collegamento esterno o una differenza del motore
li cambia.

### Ricalcolare soltanto ciò che il file non dà

Le celle versate e le formule senza valore si calcolerebbero su una copia
della cartella. Il calcolo non ha limiti di tempo né di memoria: una formula
come `SEQUENCE` su tutto il foglio, in un file di pochi kilobyte, chiede
gigabyte; i valori casuali cambiano, una catena lunga dà `#CIRC!` dove Excel
non lo dà, e le celle versate che il motore non sa riprodurre (una funzione
che non conosce, un collegamento esterno) sparirebbero senza avviso. Tenere i
valori del file non costa niente e non sbaglia.

## Verifica

- `crates/fub-format-xlsx/tests/`: la proiezione (valori, formati, aspetto,
  valori versati del file, formule senza valore, avvisi, limiti di byte e di
  righe e colonne, file cifrati e non di Excel, formule che il calcolo non
  saprebbe fermare) e il provider di formato; `tests/tempi.rs` misura i file
  di una cartella;
- `crates/fub-host/tests/xlsx_workbooks.rs`: la lettura, la scrittura
  rifiutata con il file intatto e gli errori tipizzati;
- `crates/fub-format-xlsx/tests/ts_projection.rs` e la fixture
  `apps/client/src/__fixtures__/xlsx-projection.json`, letta da
  `apps/client/src/editors/grid/workbook.test.ts` ed `engine.test.ts`;
- `crates/fub-abi/tests/dependency_invariant.rs`: i proprietari
  (`GRIDCRAFT_OWNERS`), il nucleo che non raggiunge il motore, la feature
  `xlsx` dell'host e il diagramma delle dipendenze;
- `.github/scripts/check-engine-boundary.mjs`, `node tools/vendor-craft/vendor.mjs
  gridcraft check` e i test di `vendor/gridcraft` nella CI.
