# 0219 — La cartella di Excel si modifica con i comandi di GridCraft, e il giornale diventa di comandi

- **Stato:** proposta
- **Data:** 2026-10-22
- **Ambito:** contratto
- **Sostituisce:** 0216, per il giornale di celle e per il solo innesto; 0214, per la facciata di GridCraft fuori da Fub
- **Sostituita da:** —

## Contesto

Con l'[ADR 0216](0216-protocollo-grid-2-sorgente-a-byte.md) una cartella di
Excel si modifica soltanto nei valori costanti delle celle: il testo della
`DocumentSession` è un giornale di celle e il salvataggio è un innesto a righe
sui byte del file. Formati, formule, righe e colonne, unioni, tabelle,
grafici, commenti, convalide e stampa restano fuori.

Il proprietario del progetto chiede una barra multifunzione completa come
quella di GridCraft. In GridCraft ogni azione dell'utente è un comando della
facciata `gridcraft-engine`, con un id stabile (`home.bold`,
`home.insertRows`, `data.sortAscending`), parametri JSON documentati, uno
stato acceso o spento con il motivo e una cronologia. Riscrivere quei comandi
in Fub vorrebbe dire un secondo motore del foglio, contro la direzione
dell'[ADR 0214](0214-gridcraft-motore-del-foglio-di-calcolo.md).

Tre vincoli restano: nessuna perdita silenziosa (`AGENTS.md`), nessun
ricalcolo di ciò che una modifica non raggiunge, e l'host custode dei byte
del file.

## Decisione

### La facciata entra

- `engine`, `chart` e `pdf` di GridCraft si vendorizzano accanto agli altri
  crate (`vendor/gridcraft/`, [ADR 0213](0213-provenienza-dei-motori-esterni.md)),
  e li usa soltanto `fub-format-xlsx`.
- Una cartella si apre con `DocState::from_saved` (patch `0004`): il grafo
  delle dipendenze si costruisce, e niente si valuta. Dopo un comando si
  ricalcolano le celle che il comando cambia e le loro dipendenti.
- **Fub espone un sottoinsieme dichiarato** del catalogo della facciata. Non
  entrano i comandi che leggono o scrivono file per percorso (`file.*`,
  immagini da percorso), che eseguono codice (`automate.*`), che aprono la
  rete o collegamenti esterni, né quelli dell'interfaccia di GridCraft (tema,
  lingua, finestre). Il salvataggio, l'export e la stampa sono di Fub.

### Il giornale è di comandi

- Il testo di una cartella resta un giornale (`text_kind = grid_journal`),
  nella **versione 2**: l'elenco ordinato dei comandi applicati ai byte della
  base, ognuno con l'id, i parametri e la selezione su cui è stato dato. I
  parametri sono il testo di un oggetto JSON, che nessun lato riscrive.
- Il giornale di celle della 0216 si legge ancora: ogni voce diventa un
  `cell.set` sulla stessa base.
- Il provider rifà il giornale sulla base all'apertura e tiene la sessione
  della facciata; un giornale che cresce si applica in coda, uno che torna
  indietro torna con la cronologia della facciata.
- **Annulla e ripeti sono del documento**: annulla toglie l'ultimo comando
  dal giornale, ripeti lo rimette da una pila della sessione del provider, e
  valgono per tutti i riquadri del documento. La pila di ripeti non è nel
  testo: non sopravvive alla chiusura del documento.
- Un salvataggio toglie dal giornale i comandi che ha scritto. Un comando
  salvato e annullato durante il salvataggio resta nei byte, e la shell lo
  dice.
  Per la griglia di una cartella questo sostituisce la regola dell'undo
  locale per superficie, perché un comando strutturale non si inverte nella
  superficie che non l'ha dato.

### Il contratto

La versione 2 della famiglia `grid` cresce, senza toccare un WIT congelato:

- la sessione porta il **catalogo** dei comandi serviti, con lo stato acceso
  o spento e il motivo;
- `apply` riceve, accanto alle patch, una **richiesta di comando**: l'id, i
  parametri come oggetto JSON (fino a 64 KiB) e la selezione; l'esito porta il
  diff del giornale, l'invalidazione, la selezione nuova, il risultato del
  comando (per esempio il testo copiato) e il catalogo aggiornato;
- la finestra porta lo stile completo della cella, le unioni, la
  formattazione condizionale già risolta, i commenti e i collegamenti; il
  foglio porta i riquadri bloccati, la griglia, le intestazioni, lo zoom e
  gli oggetti, con i grafici già disegnati in SVG.

I parametri sono JSON e non un elenco tipizzato di Fub: il catalogo della
facciata è il contratto, con id stabili, un proprietario (il provider), un
limite di dimensione e un rifiuto tipizzato (`BadArgs`) per un id che non
serve o per parametri che non tornano. La shell non costruisce parametri che
la facciata non documenta.

### Il salvataggio sceglie la via meno invasiva

- Se i comandi cambiano soltanto l'input di celle che l'innesto sa scrivere,
  il salvataggio resta l'**innesto a righe** della 0216, con le formule.
- Altrimenti la cartella si **riscrive con il codec** di GridCraft, che porta
  così com'è ciò che non modella. Prima di coprire il file, la riscrittura si
  **misura** con un inventario del pacchetto che Fub calcola da sé, come per
  i documenti di Word: all'apertura su una prova a vuoto, a ogni salvataggio
  sui byte nuovi. Ciò che la riscrittura perderebbe è un errore tipizzato: il
  file resta com'era e la shell offre di salvare una copia accanto, con le
  perdite dette.
- Una cartella che la prova a vuoto non conserva si modifica soltanto con i
  comandi che l'innesto sa scrivere, e la barra lo dice.

## Conseguenze

### Positive

- Un solo motore del foglio di calcolo, quello di GridCraft, anche per i
  comandi.
- La barra di Fub e quella di GridCraft parlano gli stessi id.
- Ciò che si tocca soltanto nei valori resta un innesto: il resto del file
  non cambia di un byte.

### Negative

- La riscrittura cambia byte che l'utente non ha toccato (ordine delle voci,
  stringhe condivise, stili); il contenuto resta, e l'inventario lo prova.
- Un comando strutturale ricalcola ciò che la facciata ricalcola; un valore
  che GridCraft calcola diverso da Excel cambia, e la cella lo dice.
- Rifare il giornale con funzioni volatili non dà gli stessi valori.
- Il contratto porta JSON dentro un campo, limitato a un catalogo.

## Alternative scartate

### Riscrivere i comandi in Fub

Un secondo motore del foglio accanto a GridCraft, con una semantica che si
allontana da quella di Excel.

### Parametri tipizzati da Fub

Un tipo di Fub per ognuno dei parametri della facciata (regole della
formattazione condizionale, stili, matrici di valori) duplicherebbe lo schema
di un catalogo che cambia con l'upstream.

### Riscrivere sempre con il codec

Ogni salvataggio cambierebbe il file anche per un solo numero, e una cartella
che il codec non conserva non si modificherebbe affatto.

## Verifica

- `crates/fub-abi/src/grid_bytes.rs`: la forma canonica del giornale di
  comandi, i limiti, celle e comandi mai insieme, il rebase sul prefisso
  salvato; il mirror `apps/client/src/state/grid-journal.ts` con la fixture
  `GridJournalRebase`;
- `vendor/gridcraft/crates/engine/src/tests.rs`: una cartella aperta senza
  ricalcolo tiene i valori del file finché una modifica non li raggiunge;
- i test di `fub-format-xlsx` sul giornale di comandi, sul sottoinsieme
  esposto e sulla scelta fra innesto e riscrittura misurata;
- la conformità nativo e WASM della versione 2 con il catalogo vuoto
  dell'esempio `esempi/grid-wasm`.
