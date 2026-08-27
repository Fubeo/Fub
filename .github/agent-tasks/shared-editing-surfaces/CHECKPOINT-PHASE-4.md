# Checkpoint finale — autorizzazione Fase 4

La Fase 4 (`DocumentSession`) non può iniziare finché ogni voce seguente non è provata sul risultato aggregato F0–F3.

## Architettura

- [ ] `TextEngine` è l'unico owner della meccanica CodeMirror condivisa.
- [ ] `TextEngine` non importa né nomina Markdown, wikilink, tag, live preview o `SyntaxForm`.
- [ ] `MarkdownProfile` usa `TextEngine` e conserva il comportamento osservabile precedente.
- [ ] `createEditor` è assente oppure resta soltanto come adapter temporaneo; non è un secondo engine.
- [ ] La history del testo usa le API pubbliche native nel `historyCompartment`
  di `TextEngine`; non esiste una seconda pila custom.
- [ ] [`SURF-023R`](tasks/SURF-023R.md): `EditorChange` conserva `text` e
  `TextOperation` emessi da `TextEngine` attraverso l'adapter legacy
  `createEditor`; questo tipo resta interno e non diventa un contratto IPC,
  ABI o WIT.
- [ ] `PlainTextProfile` usa lo stesso engine e non acquisisce semantica Markdown.
- [ ] `FormulaProfile` usa lo stesso engine e dimostra single-line, operatori, numeri, stringhe, A1, completamenti, commit e cancel.
- [ ] Una fixture a tre profili prova una capacità/fix generica senza duplicazioni nei profili.
- [ ] Nessun import `@codemirror/*` o `codemirror` esiste fuori da `apps/client/src/editors/text/**`.
- [ ] Il guard CI rende permanente il confine CodeMirror.

## Comportamento

- [ ] Cambio documento elimina la history precedente.
- [ ] Sync programmatico fra surface non entra nell'undo locale.
- [ ] Due pane sullo stesso documento condividono il testo ma conservano rami
  nativi, history di selezione e cursore locali.
- [ ] `historyKeymap` completa gestisce undo/redo del contenuto e
  `undoSelection`/`redoSelection`; `history()` gestisce `beforeinput` con
  `historyUndo` e `historyRedo`.
- [ ] Sync esterno usa `Transaction.addToHistory.of(false)` insieme a
  `Transaction.remote.of(true)` e rimappa i rami non ambigui.
- [ ] `HistoryFootprints` conserva al massimo 512 intervalli o anchor, senza
  payload testuale, e valuta il `ChangeDesc` effettivo.
- [ ] Un overlap ambiguo, una metadata sconosciuta o un mapping fallito
  rimuove e reinserisce la history in due transazioni pubbliche successive,
  scartando entrambi i rami prima del sync; un reset fallito interrompe il
  cambio esterno.
- [ ] [`SURF-023R`](tasks/SURF-023R.md): `written()` in `document.ts`, quando il
  `Buffer` esiste, valida `EditorChange.operation` contro il `Buffer`
  autorevole e rifiuta un'operazione stantia o incoerente, riallineando la
  superficie sorgente senza sovrascrivere il testo corrente.
- [ ] Il fan-out passa `{ text, operation }` soltanto alle altre superfici dello
  stesso documento; `TextEngine.syncDoc()` valida il cambio e usa
  `operationFromText()` solo come fallback.
- [ ] UTF-8 e offset restano corretti.
- [ ] CRLF e politica sui file misti restano corrette.
- [ ] Cambio tema non ricostruisce il documento né perde history.
- [ ] Sola lettura blocca undo/redo del contenuto ma conserva i rami nativi fino
  al ritorno in scrittura; la history della selezione resta distinta.
- [ ] `destroy()` rilascia la surface senza danneggiare le altre.
- [ ] Markdown source/live preview/completions/comandi/corpus restano verdi.
- [ ] Nessuna differenza visuale intenzionale è stata introdotta.

## Confini non toccati

Sul diff aggregato da `ROOT_BASE_SHA` alla HEAD della integration branch:

- [ ] nessuna modifica in `crates/**`;
- [ ] nessuna modifica `*.wit`;
- [ ] nessuna modifica a `apps/client/src/host/**`;
- [ ] nessuna modifica a `apps/client/src/panels/document.ts`, salvo il solo
  confine autorizzato da [`SURF-023R`](tasks/SURF-023R.md): `written()` valida
  l'operazione tipizzata contro il `Buffer` autorevole e fa fan-out nello stesso
  documento; non aggiunge meccanica generica di editor o history.
- [ ] nessuna modifica a `apps/client/src/state/layout.ts`;
- [ ] nessuna modifica a `apps/client/package.json` o `package-lock.json`;
- [ ] nessun nuovo contratto pubblico;
- [ ] nessuna nuova dipendenza.

Le sole eccezioni attese fuori dai confini generali sono il confine operativo
di [`SURF-023R`](tasks/SURF-023R.md), limitato ai path della sua spec, e il
task CI `SURF-041` nei path dichiarati dalla sua spec.

## Ownership prima della Fase 4

- [ ] `document.ts` possiede ancora buffer, revisione/base, dirty, queue, debounce,
  draft, conflitto, rename/delete/close coordination; il confine operativo non
  trasferisce nessuna di queste responsabilità.
- [ ] Nessun pezzo di `DocumentSession` è stato estratto opportunisticamente
  durante F1–F3 e il pannello non acquisisce meccanica generica di editor o
  history.
- [ ] layout/tab/focus/mode restano responsabilità della shell corrente.

## Check aggregati

Da `apps/client/`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run bench:verify
npm run bench:a11y
```

Dalla root, eseguire inoltre tutti i guard frontend/documentali toccati dal lavoro, incluso il nuovo guard CodeMirror e `check-locale-loop.mjs`.

Poi verificare la CI GitHub della integration branch quando disponibile. Tutti i job pertinenti devono essere verdi; una baseline visuale modificata non può essere accettata come soluzione.

## Verifica finale indipendente

Un Luna che non ha implementato l'ultimo task deve effettuare una review aggregata di:

```text
ROOT_BASE_SHA...HEAD(surf/shared-editing-f0-f3)
```

Deve restituire una sola decisione:

```text
READY_FOR_PHASE_4
```

oppure

```text
NOT_READY_FOR_PHASE_4
```

con blockers osservabili.

Anche con `READY_FOR_PHASE_4`, l'orchestratore si ferma: non implementa la Fase 4 senza nuova autorizzazione.