# SURF-013 — Read-only interno del TextEngine

- **Fase:** 1
- **Specie:** nuova funzionalità generica separata dall'estrazione
- **Dipendenze:** SURF-012
- **Rischio:** medio
- **Parallelismo:** no
- **Hotspot:** H1

## Obiettivo

Aggiungere al TextEngine il controllo read-only interno previsto dal piano senza esporlo al contratto pubblico.

## Motivazione

La capacità appartiene al motore generico, ma deve essere introdotta in un commit distinto dall'estrazione meccanica per mantenere causale il diff.

## allowed_paths

```text
apps/client/src/editors/text/engine.ts
apps/client/src/editors/text/engine.test.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN`.

## Invarianti

- nessuna ricostruzione della view;
- aggiornamenti programmatici restano possibili;
- nessuna conoscenza del profilo;
- nessuna modifica ABI/WIT/host.

## Acceptance criteria

- esiste `setReadOnly(true/false)` o equivalente interno;
- input utente è bloccato in read-only;
- aggiornamento programmatico continua a funzionare;
- tornare writable ripristina l'editing;
- reconfiguration, selection e history non vengono resettate dal toggle.

## Test da aggiungere/modificare

Test on/off e programmatic update nel test dell'engine.

## required_checks

```bash
cd apps/client
npm test -- src/editors/text/engine.test.ts
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `feat`.

```text
feat(editor): aggiunge sola lettura al motore testuale
```

## Trigger di escalation

- necessità di aggiungere read-only al contratto host/ABI/WIT;
- necessità di ricostruire la view e perdere history;
- dipendenza da semantica Markdown.

## Evidence richiesta

- test on/off;
- prova programmatic update in read-only;
- zero diff ai confini pubblici;
- SHA/checks.