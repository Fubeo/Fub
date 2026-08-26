# SURF-021 — Separare comandi testuali e comandi Markdown

- **Fase:** 2
- **Specie:** classificazione + spostamento meccanico
- **Dipendenze:** SURF-013
- **Rischio:** medio
- **Parallelismo:** Wave B con SURF-020
- **Hotspot:** H3

## Obiettivo

Classificare uno per uno i comandi dell'editor e spostare nel livello shared soltanto quelli con semantica realmente testuale, lasciando nel profilo Markdown i gesti che interpretano o producono sintassi Markdown/Obsidian.

## allowed_paths

```text
apps/client/src/editor/editor-commands.ts
apps/client/src/editor/editor-commands.test.ts
apps/client/src/editors/text/commands*
apps/client/src/editors/text/profiles/markdown/commands*
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più `engine.ts` e `editor.ts`.

## Classificazione iniziale da verificare

**Shared text:**

- duplicate lines;
- move line up/down.

**Markdown:**

- bold/italic/strike/inline-code delimiters;
- wikilink;
- liste e checkbox;
- smart list enter;
- auto-pair `[[`, `==`, `$`;
- trasformazioni bullet/ordered.

`indentWithTab` resta meccanica base del TextEngine, non va duplicato in questo task.

Se l'ispezione dimostra una classificazione diversa, motivarla nell'evidence; non spostare nel core un comando solo perché è conveniente.

## Invarianti

- bindings invariati;
- comportamento invariato;
- nessuna semantica Markdown nel modulo shared;
- i test seguono il proprio comando senza essere riscritti.

## Acceptance criteria

- esiste una separazione owner-per-command chiara;
- modulo shared non importa regole Markdown/Obsidian;
- test e keybinding guard restano verdi;
- vecchio entry point può restare re-export temporaneo.

## required_checks

```bash
cd apps/client
npm test -- src/editor/editor-commands.test.ts
npm test -- src/ui/keybindings.test.ts
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `refactor`.

```text
refactor(editor): separa i comandi testuali da Markdown
```

## Trigger di escalation

- comando ambiguo che richiede nozione di formato/documento per classificarlo;
- modifica necessaria al TextEngine;
- collisioni di keybinding nuove o cambiate.

## Evidence richiesta

- tabella comando → owner;
- elenco binding prima/dopo;
- import list del modulo shared;
- SHA/checks.