# SURF-041 — Guard CI del confine CodeMirror

- **Fase:** 3 hardening
- **Specie:** CI guard
- **Dipendenze:** SURF-040
- **Rischio:** basso-medio
- **Parallelismo:** no
- **Hotspot:** H5

## Obiettivo

Rendere automaticamente rossa ogni futura violazione del confine CodeMirror.

## allowed_paths

```text
.github/scripts/check-codemirror-boundary.mjs
.github/workflows/ci.yml
CONTRIBUTING.md
```

Questi path sono eccezioni esplicite a `GLOBAL-FORBIDDEN` per questo task.

## forbidden_paths

Tutto il resto di `GLOBAL-FORBIDDEN` e qualunque sorgente frontend: SURF-040 deve aver già reso il repository conforme.

## Invarianti

- niente modifica a package scripts/dipendenze;
- il guard verifica una proprietà architetturale, non un ordine estetico dei file;
- nessuna allowlist per singolo feature module fuori dal package text.

## Acceptance criteria

- scansiona almeno `.ts/.tsx` di produzione e test sotto `apps/client/src`;
- intercetta import da `@codemirror/*` e da `codemirror`;
- consente tali import soltanto sotto `apps/client/src/editors/text/`;
- self-test dimostra caso permesso e violazione;
- il guard entra nel job `client` della CI;
- `CONTRIBUTING.md` viene aggiornato quanto basta perché il local-loop guard continui a considerare il nuovo comando;
- guard attuale verde sul repository.

## Test da aggiungere/modificare

Self-test del guard. Non aggiungere eccezioni ad hoc.

## required_checks

```bash
node .github/scripts/check-codemirror-boundary.mjs --self-test
node .github/scripts/check-codemirror-boundary.mjs
node .github/scripts/check-locale-loop.mjs --self-test
node .github/scripts/check-locale-loop.mjs
cd apps/client
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `ci`.

```text
ci(editor): presidia il confine CodeMirror
```

## Trigger di escalation

- per rendere verde il guard servirebbe una eccezione fuori dal package text;
- il local-loop richiede modifiche documentali più ampie del comando aggiunto;
- la property non è misurabile senza introdurre una dipendenza nuova.

## Evidence richiesta

- output self-test positivo/negativo;
- output guard sul repo;
- punto esatto del job CI;
- output local-loop;
- SHA.