# SURF-010 — Spostamento meccanico del tema testuale

- **Fase:** 1, prework meccanico autorizzato nella Wave A
- **Specie:** spostamento meccanico
- **Dipendenze di implementazione:** nessuna
- **Gate downstream:** SURF-011 attende SURF-001, SURF-002 e SURF-010 integrati
- **Rischio:** basso
- **Parallelismo:** Wave A
- **Hotspot:** nessuno condiviso con 001/002

## Obiettivo

Portare il tema CodeMirror generico sotto il nuovo package testuale senza cambiare una singola regola o valore.

## Motivazione

Il tema è già chiaramente meccanica condivisa e protetta dalle baseline visuali. Separarne il move riduce il diff di `TextEngine`.

## allowed_paths

```text
apps/client/src/editor/theme.ts
apps/client/src/editors/text/theme.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN`.

## Invarianti

- stessi token CSS;
- stesso `HighlightStyle` e ordine;
- stesso flag `dark`;
- nessun colore o regola nuova;
- nessuna modifica visuale intenzionale.

## Acceptance criteria

- move/re-export meccanico;
- ogni chiamante corrente continua a compilare;
- nessuna baseline modificata;
- `bench:verify` e `bench:a11y` verdi.

## Test da aggiungere/modificare

Nessun nuovo test salvo import strettamente necessari. Non duplicare test del tema.

## required_checks

```bash
cd apps/client
npm run typecheck
npm test
npm run build
npm run bench:verify
npm run bench:a11y
```

## Commit

Tipo: `refactor`.

```text
refactor(editor): sposta il tema nel package testuale
```

## Trigger di escalation

- qualsiasi screenshot differente;
- necessità di modificare CSS o regole del tema;
- il move richiede modifiche a package/lockfile.

## Evidence richiesta

- diff che mostri la natura meccanica;
- elenco di eventuali re-export temporanei;
- prova di zero baseline modificate;
- output visual/a11y.