# SURF-031 — FormulaProfile

- **Fase:** 3
- **Specie:** nuova funzionalità / cliente reale distinto
- **Dipendenze:** SURF-023R
- **Rischio:** medio-alto
- **Parallelismo:** Wave C con SURF-030
- **Hotspot:** nessuno; `engine.ts` è vietato

## Obiettivo

Realizzare un profilo formula abbastanza diverso da Markdown da dimostrare l'astrazione: single-line configurabile, lessico formula, completamenti locali/iniettati, commit e cancel espliciti.

## allowed_paths

```text
apps/client/src/editors/text/profiles/formula.ts
apps/client/src/editors/text/profiles/formula.test.ts
apps/client/src/editors/text/profiles/formula/**
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più `apps/client/src/editors/text/engine.ts` e `profiles/markdown/**`.

## Invarianti

- nessun IPC/WASM;
- nessun accesso diretto a workbook/sheet globale;
- dati per completamento fogli/funzioni sono iniettati dalla shell/embedding come valori o callback interni, mai pubblicati nel contratto;
- nessuna nuova dependency;
- niente semantica Markdown.

## Acceptance criteria

- single-line: una battuta newline non crea una seconda riga;
- operatori formula riconosciuti;
- numeri riconosciuti;
- stringhe riconosciute;
- riferimenti A1 riconosciuti;
- completamento di funzioni;
- completamento di fogli/nomi iniettati;
- `Enter` produce commit esplicito;
- `Escape` produce cancel esplicito;
- monta sul medesimo TextEngine di Markdown/Plain;
- nessun host call per battuta/completion.

La forma esatta del lessico interno è implementativa; non creare un nuovo linguaggio pubblico o un parser autorevole di workbook.

## Test da aggiungere/modificare

- riconoscimento/tokenizzazione minimale;
- completion source;
- single-line;
- commit/cancel;
- mount reale con TextEngine.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/profiles/formula.test.ts
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `feat`.

```text
feat(editor): aggiunge il profilo formula
```

## Trigger di escalation

- necessità di modificare TextEngine;
- proposta di nuova dipendenza npm;
- necessità di interrogare workbook/host via IPC durante la digitazione;
- necessità di pubblicare callback/tipi Formula nell'ABI/WIT.

## Evidence richiesta

- matrice requisito → test;
- import list del profilo;
- prova zero host calls;
- prova vero TextEngine;
- SHA/checks.