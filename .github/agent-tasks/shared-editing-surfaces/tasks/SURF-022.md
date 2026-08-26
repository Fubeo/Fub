# SURF-022 — Costruire MarkdownProfile

- **Fase:** 2
- **Specie:** astrazione/migrazione semantica nel profilo
- **Dipendenze:** SURF-020, SURF-021
- **Rischio:** alto
- **Parallelismo:** no
- **Hotspot:** H4

## Obiettivo

Creare il primo vero profilo che componga language support Markdown, live preview, `SyntaxForm`, completamenti e comandi Markdown sopra il seam di riconfigurazione del TextEngine.

## allowed_paths

```text
apps/client/src/editors/text/profiles/markdown/**
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più `apps/client/src/editors/text/engine.ts` e `apps/client/src/editor/editor.ts`.

## Invarianti

- il profilo può conoscere Markdown, l'engine no;
- callbacks e completion sources restano shell-private;
- nessun host call diretto dal profilo;
- `SyntaxForm` resta semantica del profilo;
- il profilo non ricostruisce il documento per cambiare live preview/forms.

## Acceptance criteria

- `MarkdownProfile` produce tutta la configurazione Markdown oggi montata da `createEditor`;
- live preview on/off riconfigura senza perdere history;
- cambio `SyntaxForm` riconfigura senza perdere documento/history;
- completamenti e comandi correnti restano disponibili;
- tutti i test Markdown preesistenti passano senza expected indebolite.

## Test da aggiungere/modificare

Aggiungere un test di composizione del profilo; mantenere i test specifici già esistenti.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/profiles/markdown
npm run typecheck
npm test
npm run build
npm run bench:verify
npm run bench:a11y
```

## Commit

Tipo: `refactor`.

```text
refactor(editor): introduce il profilo Markdown
```

## Trigger di escalation

- il profilo richiede una nuova primitive del TextEngine;
- serve modificare `engine.ts` da questo task;
- serve un nuovo host/IPC;
- una funzione Markdown non può essere conservata senza cambiare comportamento.

## Evidence richiesta

- elenco componenti/extension posseduti dal profilo;
- prova reconfiguration/history;
- prova assenza host call;
- SHA/checks/visual.