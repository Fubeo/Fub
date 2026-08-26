# SURF-032 — Fixture a tre profili

- **Fase:** 3
- **Specie:** test di integrazione architetturale
- **Dipendenze:** SURF-030, SURF-031
- **Rischio:** medio
- **Parallelismo:** no
- **Hotspot:** nessuno di produzione

## Obiettivo

Montare contemporaneamente Markdown, Plain e Formula usando la stessa implementazione di TextEngine e dimostrare la condivisione per comportamento.

## allowed_paths

```text
apps/client/src/editors/text/*integration.test.ts
apps/client/src/editors/text/__fixtures__/**
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più tutti i file di produzione di engine e profili.

## Invarianti

- il test usa il vero TextEngine e i veri profili;
- nessuna duplicazione di utility core nel test;
- distruggere una surface non tocca le altre.

## Acceptance criteria

- tre istanze montate contemporaneamente;
- tutte supportano get/set/sync/selections/theme/destroy tramite core;
- almeno una prova parametrizzata dimostra sync senza contaminazione undo su tutti i profili;
- Markdown conserva le proprie feature;
- Plain non le acquisisce;
- Formula conserva single-line/commit/cancel;
- destroy di una non altera le altre.

## Test da aggiungere/modificare

Un test di integrazione parametrizzato; nessun fake TextEngine.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text
npm run typecheck
npm test
npm run build
npm run bench:verify
```

## Commit

Tipo: `test`.

```text
test(editor): verifica i tre profili sul motore condiviso
```

## Trigger di escalation

- uno dei profili ha duplicato una funzione core;
- il test può passare senza usare il vero engine;
- emergono comportamenti incompatibili che richiedono un cambio core.

## Evidence richiesta

Matrice `Markdown | Plain | Formula` × capacità generiche, più SHA/checks.