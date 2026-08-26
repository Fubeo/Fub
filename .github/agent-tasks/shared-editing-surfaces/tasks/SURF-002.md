# SURF-002 — Due surface reali e undo locali distinti

- **Fase:** 0
- **Specie:** test di caratterizzazione end-to-end frontend
- **Dipendenze:** nessuna
- **Rischio:** medio
- **Parallelismo:** Wave A
- **Hotspot:** H2

## Obiettivo

Aggiungere un singolo scenario E2E alla shell che apra lo stesso documento in due pane, modifichi entrambi e dimostri buffer condiviso e history locali distinte.

## Motivazione

Il wiring esiste già, ma layout e wrapper sono verificati soprattutto separatamente. È il principale buco della Fase 0.

## allowed_paths

```text
apps/client/src/shell.e2e.test.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più qualunque codice di produzione.

## Invarianti

- un solo buffer logico per documento;
- due `EditorView`/surface distinte;
- sync A→B e B→A non entra come digitazione locale;
- ogni pane conserva la propria history.

## Acceptance criteria

1. lo stesso documento è visibile in due pane;
2. digitare in A aggiorna B;
3. digitare in B aggiorna A;
4. undo in A rimuove la modifica locale di A ma non quella locale di B;
5. undo in B agisce sulla propria history;
6. dopo ogni passaggio il testo sincronizzato delle due surface coincide.

## Test da aggiungere/modificare

Un solo scenario nel vero harness `shell.e2e.test.ts`. Riusa `main.ts`, shell reale e fake host già esistenti; non creare un secondo mini-host per `document.ts`.

## required_checks

```bash
cd apps/client
npm test -- src/shell.e2e.test.ts
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `test`.

```text
test(editor): caratterizza due superfici dello stesso documento
```

## Trigger di escalation

- il comportamento reale di undo/sync contraddice il TODO;
- servirebbe modificare `document.ts` per far passare il test;
- il test richiede una nuova API pubblica del wrapper.

## Evidence richiesta

- sequenza esatta dei gesti A/B/undo;
- testo osservato dopo ogni gesto;
- SHA candidato;
- output dei required checks.