# SURF-023 — Migrare createEditor come adapter Markdown

- **Fase:** 2
- **Specie:** migrazione di un cliente con adapter
- **Dipendenze:** SURF-022
- **Rischio:** alto
- **Parallelismo:** no
- **Hotspot:** H1

## Obiettivo

Fare in modo che il vecchio `createEditor()` realizzi il comportamento corrente tramite `TextEngine + MarkdownProfile`, senza coinvolgere `document.ts`.

## allowed_paths

```text
apps/client/src/editor/editor.ts
apps/client/src/editor/editor.test.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN`.

## Invarianti

- firma legacy di `Editor`/`createEditor` compatibile con i chiamanti;
- `setSyntaxForms`, `setLivePreview`, theme, set/sync/reveal/selections/destroy mantengono la stessa semantica;
- `document.ts` rimane byte-for-byte invariato;
- adapter non contiene una seconda implementazione della meccanica del motore.

## Acceptance criteria

- `editor.ts` è un adapter sottile;
- non importa direttamente internals CodeMirror se non strettamente necessario durante la migrazione; obiettivo preferito: zero import CodeMirror;
- Markdown passa sempre attraverso `MarkdownProfile`;
- full E2E e visual regression verdi.

## Test da aggiungere/modificare

Solo smoke/parity dell'adapter; non duplicare test del core/profile.

## required_checks

```bash
cd apps/client
npm run typecheck
npm test
npm run build
npm run bench:verify
npm run bench:a11y
```

Verificare inoltre che `apps/client/src/panels/document.ts` non compaia nel diff.

## Commit

Tipo: `refactor`.

```text
refactor(editor): migra createEditor al profilo Markdown
```

## Trigger di escalation

- serve cambiare `document.ts` o `PaneMode`;
- serve cambiare `SyntaxForm` nel contratto;
- adapter necessita logica duplicata rispetto all'engine;
- differenza visuale o E2E non spiegata.

## Evidence richiesta

- call graph sintetico legacy → adapter → engine/profile;
- prova zero diff `document.ts`;
- full suite + visual/a11y;
- SHA.