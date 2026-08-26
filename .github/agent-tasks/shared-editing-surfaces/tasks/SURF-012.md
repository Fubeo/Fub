# SURF-012 — Seam di riconfigurazione del profilo

- **Fase:** 1
- **Specie:** astrazione
- **Dipendenze:** SURF-011
- **Rischio:** medio-alto
- **Parallelismo:** no
- **Hotspot:** H1

## Obiettivo

Permettere al TextEngine di sostituire la configurazione interna di un profilo tramite un seam CodeMirror interno al package, senza ricostruire la view o perdere stato locale.

## Motivazione

Markdown, Plain e Formula devono configurare lo stesso motore. Il motore non deve conoscere i loro nomi o domini.

## allowed_paths

```text
apps/client/src/editors/text/engine.ts
apps/client/src/editors/text/engine.test.ts
apps/client/src/editor/editor.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN`.

## Invarianti

- stessa `EditorView` durante reconfiguration;
- stesso documento;
- selezione preservata;
- history preservata;
- tema non ricostruito;
- nessun profilo nominato dal core;
- nessun contratto pubblico.

## Acceptance criteria

- un profilo fittizio non-Markdown può essere montato, sostituito e rimosso;
- una modifica utente fatta prima della reconfiguration resta annullabile dopo;
- il documento e la selezione non vengono persi;
- l'API di riconfigurazione resta interna al package text/shell.

## Test da aggiungere/modificare

Test diretto con extension banale e senza Markdown. Non usare `MarkdownProfile` come prova del seam.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/engine.test.ts
npm run typecheck
npm test
npm run build
npm run bench:verify
```

## Commit

Tipo: `refactor`.

```text
refactor(editor): rende riconfigurabile il profilo testuale
```

## Trigger di escalation

- proposta di serializzare view state o DOM per far funzionare il seam;
- necessità di esporre tipi CodeMirror fuori dal package text;
- perdita inevitabile di history/selection con la soluzione proposta.

## Evidence richiesta

- prova che l'identità della view non cambia;
- test history/selezione prima→dopo;
- API interna risultante;
- SHA e checks.