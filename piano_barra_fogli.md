# Piano: la barra multifunzione dei fogli e la modifica completa con GridCraft

> **Stato:** in corso, su `feat/fogli-barra` (sopra la #231).
> **Scelta del proprietario (2026-10-22):** «Subito tutto»: la barra completa
> come quella di GridCraft, con stili, struttura, oggetti, dati, revisione e
> stampa, anche se la cartella si riscrive con il codec.
> **Regole che restano:** nessuna perdita silenziosa, nessun ricalcolo di ciò
> che non dipende da una modifica, l'host custode dei byte, `AGENTS.md`.

## In breve

Oggi Fub cambia in una cartella di Excel soltanto valori costanti, innestati
riga per riga (ADR 0216). Ogni comando della barra di GridCraft (128 nella
facciata `gridcraft-engine` v0.9.0) vive in `Session::execute` con un id
stabile (`home.bold`, `home.insertRows`, `data.sortAscending`…), parametri JSON
e uno stato acceso/spento con il motivo. Il piano porta quella facciata dentro
`fub-format-xlsx`, fa diventare il testo del documento un **giornale di
comandi** invece che di celle, e mette sopra la griglia una barra che somiglia a
quella di GridCraft.

## Decisioni da formalizzare (ADR 0219)

1. **La facciata entra.** Si vendorizzano `engine`, `chart` e `pdf` di
   GridCraft v0.9.0 con lo script `tools/vendor-craft`. Li usa soltanto
   `fub-format-xlsx`; `check-engine-boundary` e `dependency_invariant` lo
   tengono vero. Patch nuove:
   - `0004`: `DocState` si apre **senza ricalcolo** (`Calc::rebuild` al posto
     di `recalc_all`), così i valori del file restano quelli (G1);
   - nessun accesso al filesystem dalla facciata: `file.*`, `automate.*`,
     immagini da percorso e collegamenti esterni non si espongono (allow-list
     nel provider, non una patch, se basta).
2. **Il giornale diventa di comandi.** Il testo della `DocumentSession` di una
   cartella resta un giornale (`text_kind = grid_journal`), versione 2: la
   base (revisione dei byte) e la lista dei comandi applicati, ognuno con id,
   parametri tipizzati e selezione. Il giornale di celle della 0216 si legge
   ancora: ogni voce diventa un `cell.set` sulla stessa base. Bozze, conflitti,
   rinomina e cestino restano quelli della `DocumentSession`.
3. **La cronologia è del documento.** Annulla e ripeti sono `edit.undo` e
   `edit.redo` della facciata, condivisi fra i riquadri dello stesso
   documento; nel giornale tolgono o rimettono l'ultimo comando. È una
   differenza dalla regola «undo locale per superficie», da scrivere.
4. **Il salvataggio sceglie il modo meno invasivo.**
   - Se i comandi cambiano soltanto input di celle (valori o formule) su celle
     che l'innesto sa scrivere, resta l'**innesto a righe** della 0216, più le
     formule.
   - Altrimenti la cartella si **riscrive con il codec** di GridCraft, che
     porta le parti che non modella (`passthrough`). Prima di scrivere si
     **prova la riscrittura**: si rilegge il risultato e si confronta con il
     modello; e ciò che la lettura ha dichiarato perso (avvisi della lettura,
     parti non modellate e non portate) è una **perdita**. Con una perdita la
     riscrittura non copre il file: è un errore tipizzato che la shell dice,
     con l'alternativa «Salva una copia» accanto.
5. **Il ricalcolo è incrementale.** Dopo un comando si ricalcolano le
   dipendenti delle celle cambiate (`Calc::cells_changed`) e le volatili, mai
   tutta la cartella; all'apertura niente.
6. **Il contratto.** Si estende la famiglia `grid` versione 2, non
   congelata:
   - `GridBytesSession` porta il catalogo dei comandi serviti, con etichetta,
     gruppo della barra, scorciatoia e tipo dei parametri;
   - una richiesta `command` (id, parametri tipizzati, selezione) accanto alle
     patch di `GridApplyRequest`; l'esito porta lo stato nuovo dei comandi
     (acceso, premuto, valore corrente: carattere, dimensione, formato
     numerico), la selezione nuova e l'invalidazione;
   - la finestra porta lo stile completo (carattere, colori, bordi,
     allineamento, rientro, a capo, rotazione), le unioni, la formattazione
     condizionale già risolta, i commenti e i collegamenti; il foglio porta
     blocca riquadri, griglia, intestazioni, zoom e gli oggetti (grafici come
     SVG già disegnato, immagini come risorse del vault);
   - i parametri sono un elenco chiuso di nomi e valori scalari tipizzati
     (testo, numero, booleano, intervallo, colore, elenco di testi), non JSON
     libero; un comando che vuole altro non si espone finché il tipo non c'è;
   - mirror TypeScript, fixture, fake host, WIT `grid-bytes` e
     `esempi/grid-wasm` (che dichiara un catalogo vuoto e rifiuta i comandi
     con il tipo giusto).

## Le fasi

Ogni fase finisce con commit piccoli, la CI verde e la porta 1432 aggiornata.

| Fase | Contenuto | Uscita |
|---|---|---|
| B0 | vendor di `engine`, `chart`, `pdf`; patch 0004; `cargo deny`; confini | la facciata compila in Fub e i suoi test passano |
| B1 | ADR 0219; giornale di comandi in `fub-abi` con la regola canonica e il mirror | fixture Rust↔TS del giornale, lettura del giornale di celle |
| B2 | contratto: catalogo, `command`, stato, stile completo, unioni, oggetti; WIT; mirror; fake; WASM | conformità nativo e WASM |
| B3 | `fub-format-xlsx`: sessione della facciata per sessione grid, allow-list, replay del giornale, salvataggio con innesto o riscrittura provata | test con file veri del corpus, rilettura LibreOffice |
| B4 | griglia: stile completo, unioni, blocca riquadri, griglia, zoom, oggetti; selezione e scorciatoie verso i comandi; annulla del documento | Vitest, banco visivo e a11y |
| B5 | barra multifunzione: schede Home, Inserisci, Disegna, Layout di pagina, Formule, Dati, Revisione, Visualizza, schede contestuali (Tabella, Grafico); controlli grandi e piccoli, menu, gallerie, caselle combinate; stato dal provider; tasti di accesso; riduzione dei gruppi a larghezza stretta | banco visivo nelle due luci e stretto, a11y |
| B6 | finestre di dialogo: Formato celle, Formattazione condizionale, Ordina, Trova e sostituisci, Inserisci funzione, Convalida dati, Gestione nomi, Incolla speciale, Vai a | test dei dialoghi, a11y |
| B7 | oggetti: grafici, immagini dal vault, forme, caselle di testo, tabelle, pivot, filtri dei dati | test con file veri |
| B8 | layout di pagina e stampa: anteprima, PDF con l'export di Fub (ADR 0211) | export misurato |
| B9 | revisione: commenti, note, protezione del foglio e della cartella | test |
| B10 | documentazione canonica, scene del banco, baseline dal runner | guard documentali |

## Esclusi e perché

- **Automate (script):** Fub non esegue codice di un documento.
- **File (apri, salva come, chiudi):** sono della shell di Fub e della
  `DocumentSession`.
- **Dati esterni e collegamenti ad altre cartelle:** chiederebbero il
  filesystem o la rete fuori dalla custodia dell'host.

## Rischi

- La riscrittura perde ciò che il codec non porta: la prova prima di scrivere
  è la sola difesa, e va provata con il corpus.
- Il replay del giornale con funzioni volatili non è deterministico: si dice.
- La facciata è grande (25.000 righe) e cambia in fretta: si aggiorna con
  `tools/vendor-craft`, come WordCraft.
- Il bundle del client cresce: la barra si carica soltanto con una cartella
  aperta.
