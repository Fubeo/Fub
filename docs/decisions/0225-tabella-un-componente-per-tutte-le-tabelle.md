# 0225 — Tabella, un componente per tutte le tabelle

- **Stato:** proposta
- **Data:** 2026-10-27
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub mostra tabelle in tre posti, e ognuno aveva il suo programma:

- il foglio di una cartella di Excel (`editors/grid/engine.ts`);
- la griglia delle tabelle Markdown in Live
  (`editors/text/profiles/markdown/table-grid.ts`);
- le tabelle dei documenti di Word (`editors/rich/`), dove si scriveva nelle
  celle ma non si passava da una cella all'altra col Tab né si sceglievano
  più celle.

Stessi gesti, tasti diversi; stessi comandi, codice copiato. Con la griglia
del foglio rifatta, il Markdown e i documenti restavano indietro.

## Decisione

1. **Un pacchetto, `apps/client/src/tabella/`.** Ci stanno le regole pure di
   ogni tabella: la navigazione (`navigation.ts`), la selezione a più
   intervalli e il riempimento (`selection.ts`), gli appunti in TSV e HTML
   (`clipboard.ts`), le serie (`series.ts`), l'ordinamento (`sort.ts`), i
   tasti in due modi (`keys.ts`), il catalogo dei comandi con gli id pubblici
   che la barra e i menu già nominavano (`commands.ts`) e la scheda «Tabella» della barra multifunzione
   (`ribbon.ts`).
2. **Un contratto chiuso.** L'adattatore dichiara le capacità del formato
   (`TableCaps`: inserire, togliere, spostare righe e colonne, ordinare,
   allineare, unire, righe d'intestazione) e riceve ogni gesto come un
   `TableEdit`, un'unione chiusa (`adapter.ts`). Un comando che chiede una
   capacità assente non compare; uno che qui non vale si spegne.
3. **Una cornice per le tabelle nel flusso del testo.** `tabella/frame/frame.ts`
   disegna la griglia con lettere e numeri, la cella attiva, la selezione,
   la maniglia di riempimento e i «+», e la fa funzionare coi tasti del modo
   «foglio». Il Markdown in Live è il suo primo adattatore: `table-grid.ts`
   traduce i `TableEdit` col modello di `table-model.ts` e tiene le enfasi
   del Markdown e il link della cella. La pelle è una sola,
   `theme/scrittoio/skin/tabella.css`, con le classi `tb-*`.
4. **Il documento nel modo «documento».** Nei documenti di Word il cursore
   resta nel testo della cella: Tab e Maiusc+Tab vanno di cella in cella, e
   dall'ultima Tab aggiunge una riga; Maiusc con una freccia che esce dalla
   cella, o il trascinamento da una cella all'altra, sceglie un rettangolo di
   celle (`editors/rich/cell-selection.ts`). Su quelle celle Canc svuota,
   Ctrl+C e Ctrl+X passano TSV e HTML, e «Unisci celle» unisce una riga.
5. **Il foglio condivide le regole, non ancora la cornice.** La griglia della
   cartella usa navigazione, selezione, riempimento e appunti della Tabella;
   il corpo virtuale, l'editor di cella con le formule, le misure e gli
   oggetti restano in `GridEngine`, che ha la sua resa provata al pixel.
6. **Niente `prosemirror-tables`.** La sua selezione di celle chiede
   `rowspan` e `colwidth` sullo schema, che le tabelle del documento non hanno
   (una cella ha `span`, unita soltanto in larghezza), e sarebbe una
   dipendenza nuova. La selezione di celle è uno stato di un plugin accanto
   alla selezione di testo, nostro.
7. **Un confine.** `.github/scripts/check-tabella-boundary.mjs` vieta a
   `tabella/` di importare editor, CodeMirror, ProseMirror e Tauri: può usare
   soltanto `kit/`, `moto/`, `i18n/`, `editors/core/tsv.ts` e
   `ui/lifetime.ts`, che dà un owner ai suoi ascoltatori.

## Conseguenze

### Positive

- le tabelle del Markdown e del foglio hanno gli stessi tasti, la stessa
  maniglia, gli stessi appunti e lo stesso ordinamento;
- nei documenti si va di cella in cella e si scelgono più celle come in Word;
- una prova comune (`tabella/conformance.ts`) esegue gli stessi gesti sulla
  cornice e sul Markdown, e dice dove un formato differisce.

### Negative

- il foglio non usa ancora la cornice: due disegni della stessa selezione
  restano finché `GridEngine` non la estrae;
- la selezione di celle del documento non è una `Selection` di ProseMirror:
  i comandi che non la conoscono lavorano sulla cella attiva.

## Alternative scartate

### A. `prosemirror-tables`

Avrebbe portato `CellSelection` e `TableMap` già fatti, ma su uno schema con
`rowspan` e `colwidth` che le tabelle del documento non hanno, e con una
dipendenza nuova da tenere.

### B. Un editor di tabelle per formato

È ciò che c'era: tre gesti per tre programmi, e ogni miglioramento da
copiare.

### C. Il foglio dentro la cornice adesso

`GridEngine` disegna migliaia di celle con una finestra virtuale e foto di
riferimento al pixel; spostarla in un colpo solo avrebbe messo a rischio la
griglia appena sistemata.

## Verifica

- `apps/client/src/tabella/*.test.ts` e `frame/frame.test.ts`: regole pure,
  cornice e prova comune;
- `editors/text/profiles/markdown/table-grid.test.ts`: il Markdown, prova
  comune compresa;
- `editors/rich/cell-selection.test.ts`: Tab, celle scelte, Canc, appunti e
  unione;
- `editors/grid/engine.test.ts`: il riempimento del foglio con la regola
  della Tabella;
- `node .github/scripts/check-tabella-boundary.mjs`.
