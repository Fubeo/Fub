# SURF-011 — Estrarre il primo TextEngine

- **Fase:** 1
- **Specie:** astrazione con adapter
- **Dipendenze:** SURF-001, SURF-002, SURF-010
- **Rischio:** alto
- **Parallelismo:** no
- **Hotspot:** H1

## Obiettivo

Estrarre da `createEditor` esclusivamente la meccanica testuale generica già esistente, lasciando Markdown fuori dal motore e mantenendo la vecchia factory funzionante.

## Motivazione

Creare il core riusabile senza migrare nello stesso commit il cliente Markdown e senza anticipare `DocumentSession`.

## allowed_paths

```text
apps/client/src/editor/editor.ts
apps/client/src/editor/editor.test.ts
apps/client/src/editors/text/engine.ts
apps/client/src/editors/text/engine.test.ts
apps/client/src/editors/text/theme.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più i moduli Markdown correnti `livepreview*`, `completions*`, `editor-commands*`.

## Responsabilità da estrarre

- creazione e distruzione `EditorView`;
- documento e aggiornamenti programmatici;
- replace/cambio documento;
- sync minimale;
- line ending;
- selezioni;
- byte UTF-8 ↔ offset editor;
- focus e reveal;
- tema;
- listener generici;
- setup testuale condiviso strettamente meccanico.

## Responsabilità vietate nel TextEngine

- parser/language Markdown;
- `markdown`/`markdownLanguage`;
- `SyntaxForm`;
- live preview;
- wikilink/tag;
- completamenti Markdown;
- comandi dipendenti dalla sintassi.

## Invarianti

- `createEditor` continua a funzionare come prima;
- i test di caratterizzazione restano verdi;
- nessun nuovo host call;
- tema e resa invariati;
- nessuna logica di buffer/save/sessione spostata da `document.ts`.

## Acceptance criteria

- esiste un `TextEngine` reale usato dal vecchio adapter;
- `engine.ts` non contiene import o conoscenza Markdown;
- le operazioni generiche sono testate vicino all'engine;
- vecchia API `Editor` continua a servire i chiamanti correnti;
- visual regression e a11y restano verdi.

## Test da aggiungere/modificare

I test generici esistenti possono essere spostati in `engine.test.ts` mantenendo significato e expected. Aggiungere soltanto test necessari per il nuovo seam.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/engine.test.ts
npm run typecheck
npm test
npm run build
npm run bench:verify
npm run bench:a11y
```

Aggiungere ispezione statica di `engine.ts` per import/parole Markdown vietate.

## Commit

Tipo: `refactor`.

```text
refactor(editor): estrae il motore testuale condiviso
```

## Trigger di escalation

- richiede modificare `document.ts` o `layout.ts`;
- richiede un tipo host/ABI/WIT;
- richiede spostare semantica Markdown nel core;
- il task diventa contemporaneamente estrazione e migrazione Markdown sostanziale.

## Evidence richiesta

- mappa responsabilità prima→dopo;
- import list di `engine.ts`;
- diffstat;
- SHA candidato;
- output required checks e visual check.