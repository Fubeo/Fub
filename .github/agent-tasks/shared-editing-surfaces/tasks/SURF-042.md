# SURF-042 — Documentare l'architettura ottenuta

- **Fase:** 3 checkpoint documentale
- **Specie:** documentazione del presente
- **Dipendenze:** SURF-041
- **Rischio:** basso
- **Parallelismo:** no
- **Hotspot:** documentazione

## Obiettivo

Aggiornare soltanto la documentazione canonica resa falsa dai cambi F0–F3, descrivendo l'architettura realmente esistente e non le Fasi 4+.

## allowed_paths

```text
docs/product/editor-and-preview.md
docs/architecture/frontend-and-ipc.md
docs/architecture/overview.md
```

`overview.md` va toccato solo se una proprietà generale è realmente cambiata e non può essere descritta nelle altre due pagine.

## forbidden_paths

`GLOBAL-FORBIDDEN` più `docs/project/todo-superfici-di-editing-condivise.md`, issue #11 e `docs/decisions/**`.

## Invarianti

- documentare il presente, non la destinazione futura;
- `DocumentSession` deve risultare non ancora estratta;
- `DocumentSurfaceRegistry` deve risultare non ancora architettura corrente;
- nessun nuovo contratto pubblico dichiarato;
- `createEditor` va descritto come adapter temporaneo se esiste ancora.

## Acceptance criteria

- TextEngine descritto come architettura corrente;
- Markdown/Plain/Formula distinti correttamente;
- ownership CodeMirror coerente col guard;
- nessuna frase suggerisce che Fase 4/5/ABI siano completate;
- path e nomi corrispondono al codice integrato.

## Test da aggiungere/modificare

Nessuno; eseguire tutti i guard documentali pertinenti da `CONTRIBUTING.md`.

## required_checks

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-doc-orphans.mjs
node .github/scripts/check-doc-size.mjs
node .github/scripts/check-mermaid.mjs --render
node .github/scripts/check-markdown-style.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
node .github/scripts/check-locale-loop.mjs
```

## Commit

Tipo: `docs`.

```text
docs(architecture): documenta i profili testuali condivisi
```

## Trigger di escalation

- per descrivere il risultato serve un ADR o una decisione pubblica non prevista;
- il codice integrato ha già anticipato Fase 4/5 e rende impossibile una descrizione coerente col piano.

## Evidence richiesta

- diff docs;
- mapping delle affermazioni principali ai file di codice correnti;
- output dei guard;
- SHA.