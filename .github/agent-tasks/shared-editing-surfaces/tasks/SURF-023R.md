# SURF-023R — Rendere esplicito il confine delle operazioni tipizzate

- **Fase:** 2 correttiva
- **Specie:** correzione di governance del confine interno
- **Dipendenze:** SURF-023
- **Rischio:** alto
- **Parallelismo:** no
- **Hotspot:** H1/H2

## Obiettivo

Registrare nel piano il confine interno delle operazioni tipizzate già approvato
fra `TextEngine`, l'adapter `createEditor()` e il pannello documento. Questa è
una correzione di governance: non riapre né riscrive `SURF-023`, non amplia
`GLOBAL-FORBIDDEN` e non autorizza la Fase 4.

## allowed_paths

```text
apps/client/src/editor/editor.ts
apps/client/src/editor/text-operation.ts
apps/client/src/editor/text-operation.test.ts
apps/client/src/editors/text/engine.ts
apps/client/src/editors/text/engine.test.ts
apps/client/src/editors/text/history-footprints.ts
apps/client/src/editors/text/history-footprints.test.ts
apps/client/src/panels/document.ts
apps/client/src/shell.e2e.test.ts
```

`apps/client/src/panels/document.ts` è ammesso soltanto per il percorso
`written()` e il fan-out fra superfici dello stesso documento descritti sotto.

## forbidden_paths

`GLOBAL-FORBIDDEN` più ogni path non elencato in `allowed_paths`. In particolare,
questa correzione non autorizza modifiche a `apps/client/src/host/**`,
`apps/client/src/state/layout.ts`, al contratto IPC, ABI o WIT, a Rust, al
lockfile o a una nuova dipendenza.

## Confine autorizzato

- `TextEngine` emette `EditorChange` con `text`, `TextOperation` e `origin`.
- `createEditor()` inoltra il valore tipizzato al callback legacy senza ridurlo
  a un callback text-only.
- `written()` valida `EditorChange.operation` contro il `Buffer` autorevole
  usando `tryApplyOperation`; un'operazione stantia, malformata o incoerente
  viene rifiutata e la superficie sorgente viene riallineata al buffer.
- Dopo la validazione, il coordinatore può inoltrare `{ text, operation }` solo
  alle altre superfici dello stesso documento.
- `TextEngine.syncDoc()` valida l'operazione ricevuta contro il testo corrente
  e il testo obiettivo; `operationFromText()` è soltanto il fallback locale del
  ricevente.
- La history del testo appartiene alle API pubbliche native di CodeMirror:
  `TextEngine` monta `history()` nel `historyCompartment` e il keymap effettivo
  include `historyKeymap`. Il sync usa insieme
  `Transaction.addToHistory.of(false)` e `Transaction.remote.of(true)`, così
  il cambio esterno viene mappato sui rami senza diventare una battuta locale.
- `HistoryFootprints` conserva al massimo 512 intervalli o anchor, senza testo.
  Un overlap ambiguo, una metadata sconosciuta o un mapping fallito rimuove e
  reinserisce la history in due transazioni pubbliche successive, ricostruisce
  il sync e scarta entrambi i rami prima dell'applicazione; un reset fallito
  interrompe il sync.

Il confine è interno alla shell TypeScript. `EditorChange`, `DocumentUpdate` e
`TextOperation` non attraversano `host/contract.ts`, IPC, WIT o ABI.
`document.ts` conserva `Buffer`, revisione o base, dirty, coda, debounce,
bozza, conflitto, rename, delete, close e il coordinamento del salvataggio.
Non si estrae `DocumentSession` e non si aggiunge meccanica generica di editor o
history al pannello.

## Invarianti

- l'operazione conserva preimmagine, postimmagine e intervalli verificabili;
- un cambio stantia o incoerente non sovrascrive un cambio più recente;
- il fan-out non raggiunge documenti diversi e non rientra nella superficie
  sorgente;
- una sincronizzazione esterna non diventa una battuta nei rami nativi locali;
- un overlap ambiguo non permette a undo o redo di ripristinare testo
  sovrascritto: entrambi i rami vengono scartati prima del sync;
- la rappresentazione tipizzata resta interna e non crea un nuovo contratto;
- tutte le responsabilità del `Buffer` restano nel pannello documento;
- ogni modifica resta entro i path autorizzati e lascia intatti gli altri
  confini vietati da `GLOBAL-FORBIDDEN`.

## Acceptance criteria

- il flusso engine → adapter → `written()` conserva `TextOperation`;
- un'operazione stantia o incoerente riallinea la sorgente senza sovrascrivere il
  `Buffer` autorevole;
- il fan-out passa l'operazione solo a superfici dello stesso documento;
- il destinatario valida l'operazione e preserva i rami nativi per i cambi
  esterni disgiunti;
- un overlap ambiguo invalida entrambi i rami con il reset pubblico a due fasi
  prima di applicare il cambio esterno;
- le prove focalizzate richieste devono coprire il percorso positivo, il rifiuto,
  il fallback, il mapping e l'invalidazione conservativa;
- non compaiono modifiche a IPC, ABI, WIT, Rust, `DocumentSession` o dipendenze.

## Test da aggiungere/modificare

Mantenere o aggiornare soltanto le prove focalizzate in:

- `apps/client/src/editors/text/engine.test.ts`;
- `apps/client/src/editors/text/history-footprints.test.ts`;
- `apps/client/src/editor/text-operation.test.ts`;
- `apps/client/src/shell.e2e.test.ts`.

Le prove dell'engine devono esercitare history nativa, keymap completa,
`beforeinput`, selezioni, sync disgiunto e reset su overlap. Non duplicare la
suite Markdown e non creare un secondo coordinatore del buffer.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/engine.test.ts src/editors/text/history-footprints.test.ts src/editor/text-operation.test.ts src/shell.e2e.test.ts
npm run typecheck
```

Verificare inoltre il diff contro `GLOBAL-FORBIDDEN` e che nessun tipo del
confine compaia in `apps/client/src/host/contract.ts`, IPC, WIT o ABI.
Verificare che il guard CodeMirror continui a confinare gli import a
`apps/client/src/editors/text/`.

## Commit

Tipo: `docs`.

```text
docs(governance): registra il confine delle operazioni tipizzate
```

## Trigger di escalation

- serve un path non elencato o una responsabilità del `Buffer` fuori da
  `document.ts`;
- serve modificare IPC, ABI, WIT, Rust, il lockfile o aggiungere dipendenze;
- un profilo o il motore richiede una nuova primitive non prevista;
- il fallback ricostruisce l'operazione fuori dal destinatario o il callback
  torna text-only;
- la modifica anticipa `DocumentSession`, `DocumentSurfaceRegistry` o la Fase 4.

## Evidence richiesta

- matrice path → regola autorizzata;
- prova di validazione, rifiuto, riallineamento e fan-out same-document;
- prova che un sync esterno disgiunto preserva i rami nativi e che un overlap
  invalida entrambi prima dell'applicazione;
- prova di assenza di contratto IPC/ABI/WIT e di diff fuori scope;
- SHA e output dei required checks.
