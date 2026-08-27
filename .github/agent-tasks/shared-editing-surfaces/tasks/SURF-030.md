# SURF-030 — PlainTextProfile

- **Fase:** 3
- **Specie:** nuova funzionalità / secondo cliente
- **Dipendenze:** SURF-023R
- **Rischio:** basso-medio
- **Parallelismo:** Wave C con SURF-031
- **Hotspot:** nessuno; `engine.ts` è vietato

## Obiettivo

Creare un cliente deliberatamente minimale e privo di semantica di dominio che usi il vero TextEngine.

## Motivazione

È la prima prova che l'engine non sia soltanto `MarkdownEditor` rinominato.

## allowed_paths

```text
apps/client/src/editors/text/profiles/plain-text.ts
apps/client/src/editors/text/profiles/plain-text.test.ts
apps/client/src/editors/text/profiles/plain-text/**
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più `apps/client/src/editors/text/engine.ts` e l'intero `profiles/markdown/**`.

## Invarianti

- niente parser Markdown;
- niente wikilink/tag/SyntaxForm;
- niente completamenti di dominio;
- niente duplicazione `EditorView` o delle utility core.

## Acceptance criteria

- monta sul vero TextEngine;
- stringhe come `[[Nota]] #tag **x**` restano semplice testo senza semantica Markdown;
- editing, selection, undo, sync, theme e destroy sono forniti dall'engine;
- il profilo aggiunge solo ciò che serve al plain text.

## Test da aggiungere/modificare

Profile mount + operazioni generiche attraverso il vero engine + assenza di semantica Markdown.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/profiles/plain-text.test.ts
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `feat`.

```text
feat(editor): aggiunge il profilo di testo semplice
```

## Trigger di escalation

Se il profilo necessita una modifica a `engine.ts`, fermarsi e descrivere la primitive generica mancante. Non copiarla nel profilo.

## Evidence richiesta

- prova che il test istanzia il vero TextEngine;
- prova assenza di import/semantica Markdown;
- SHA/checks.