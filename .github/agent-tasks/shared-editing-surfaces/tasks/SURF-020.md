# SURF-020 — Spostare meccanicamente i moduli Markdown

- **Fase:** 2
- **Specie:** spostamento meccanico
- **Dipendenze:** SURF-013
- **Rischio:** basso
- **Parallelismo:** Wave B con SURF-021
- **Hotspot:** non H3

## Obiettivo

Spostare live preview, completamenti e relativo corpus sotto `apps/client/src/editors/text/profiles/markdown/`, mantenendo compatibilità temporanea e zero cambi semantici.

## Motivazione

La separazione logica esiste già in moduli autonomi; prima di creare il profilo conviene rendere fisica tale ownership senza mischiarla con nuova astrazione.

## allowed_paths

```text
apps/client/src/editor/livepreview.ts
apps/client/src/editor/livepreview.test.ts
apps/client/src/editor/completions.ts
apps/client/src/editor/completions.test.ts
apps/client/src/editor/corpus.test.ts
apps/client/src/editors/text/profiles/markdown/livepreview.ts
apps/client/src/editors/text/profiles/markdown/livepreview.test.ts
apps/client/src/editors/text/profiles/markdown/completions.ts
apps/client/src/editors/text/profiles/markdown/completions.test.ts
apps/client/src/editors/text/profiles/markdown/corpus.test.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più `apps/client/src/editor/editor.ts` e `apps/client/src/editors/text/engine.ts`.

## Invarianti

- stessi casi e expected dei test Markdown;
- zero cambi di parser/decorazioni/completion;
- eventuali vecchi file sono soltanto re-export temporanei;
- fixture del corpus non viene riscritta.

## Acceptance criteria

- moduli e test risiedono nella nuova ownership Markdown o sono raggiunti tramite shim strettissimi;
- nessuna expected value modificata per il move;
- full Markdown suite verde;
- visual regression invariata.

## Test da aggiungere/modificare

Nessun nuovo comportamento. Aggiornare import/path conseguenti al move.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/profiles/markdown
npm run typecheck
npm test
npm run build
npm run bench:verify
```

## Commit

Tipo: `refactor`.

```text
refactor(editor): sposta il comportamento Markdown nel profilo
```

## Trigger di escalation

- necessità di cambiare expected value;
- necessità di modificare l'engine;
- un comportamento oggi implicitamente dipende dal vecchio path/ordine in modo non meccanico.

## Evidence richiesta

- rename/move map;
- conteggio test prima/dopo;
- lista shim temporanei;
- SHA/checks.