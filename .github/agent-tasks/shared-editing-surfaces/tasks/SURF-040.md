# SURF-040 — Confinare tutti gli import CodeMirror nel package text

- **Fase:** 3 hardening
- **Specie:** migrazione meccanica dei clienti/test
- **Dipendenze:** SURF-032
- **Rischio:** medio
- **Parallelismo:** no
- **Hotspot:** H2/H3, ormai liberi

## Obiettivo

Rendere vera la proprietà che ogni import diretto da `@codemirror/*` o `codemirror` vive sotto `apps/client/src/editors/text/**`, prima di attivare un guard CI.

## allowed_paths

```text
apps/client/src/shell.e2e.test.ts
apps/client/src/ui/keybindings.test.ts
apps/client/src/editor/**
apps/client/src/editors/text/**
```

## forbidden_paths

`GLOBAL-FORBIDDEN` salvo i path allowed sopra.

## Invarianti

- nessuna nuova API production soltanto per permettere ai test di raggiungere internals CodeMirror;
- test CodeMirror-centric possono essere spostati nel package text;
- shell E2E può usare un test-support interno al package, non importare CodeMirror direttamente;
- `createEditor` può restare adapter se ancora necessario.

## Acceptance criteria

Una ricerca dell'intero `apps/client/src` deve restituire zero import:

```text
@codemirror/*
codemirror
```

fuori da:

```text
apps/client/src/editors/text/**
```

Shim morti in `apps/client/src/editor/` vengono rimossi soltanto se non sono più usati; l'adapter compatibile può restare.

## Test da aggiungere/modificare

Nessun nuovo comportamento. Ricollocare/adattare test mantenendo le stesse proprietà.

## required_checks

```bash
cd apps/client
npm run typecheck
npm test
npm run build
```

Più ricerca statica completa degli import CodeMirror in `apps/client/src`.

## Commit

Tipo: `refactor`.

```text
refactor(editor): confina CodeMirror nel package testuale
```

## Trigger di escalation

- per confinare gli import occorre esporre `EditorView` dal runtime pubblico;
- un modulo non-text usa realmente CodeMirror come dipendenza di produzione e non può migrare senza decisione architetturale.

## Evidence richiesta

- elenco path con import CodeMirror prima/dopo;
- dopo: esclusivamente `editors/text/**`;
- SHA/checks.