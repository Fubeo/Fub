# SURF-001 — Caratterizzare sync e ponte UTF-8

- **Fase:** 0
- **Specie:** test di caratterizzazione
- **Dipendenze:** nessuna
- **Rischio:** basso
- **Parallelismo:** Wave A
- **Hotspot:** nessuno di produzione

## Obiettivo

Aggiungere soltanto le caratterizzazioni mancanti del wrapper corrente: `syncDoc`, history locale, mapping della selezione, `revealByteOffset` con UTF-8/CRLF e preservazione della history al cambio tema.

## Motivazione

Questi comportamenti generici verranno estratti in `TextEngine`. Il codice esiste già, ma non tutti i versi sono direttamente presidiati. L'estrazione non deve precedere la caratterizzazione.

## allowed_paths

```text
apps/client/src/editor/editor.test.ts
```

## forbidden_paths

`GLOBAL-FORBIDDEN` più qualunque file di produzione.

## Invarianti

- nessuna modifica al comportamento corrente;
- non duplicare i test già presenti per `setDoc`, CRLF, selections o teardown;
- una modifica programmatica remota non diventa una battuta locale.

## Acceptance criteria

- `syncDoc` non crea una voce undo propria;
- una modifica utente precedente resta annullabile dopo un sync remoto;
- il sync non azzera inutilmente la selezione/cursore;
- byte UTF-8 → posizione editor funziona con testo multibyte;
- esiste un caso combinato multibyte + CRLF per `revealByteOffset` o equivalente ponte inverso;
- cambiare tema non distrugge la history locale.

## Test da aggiungere/modificare

Nuovi casi mirati in `editor.test.ts`. Nessun helper di produzione aggiunto per il solo test.

## required_checks

```bash
cd apps/client
npm test -- src/editor/editor.test.ts
npm run typecheck
npm test
npm run build
```

## Commit

Tipo: `test`.

Messaggio raccomandato:

```text
test(editor): caratterizza sync e offset del motore testuale
```

## Trigger di escalation

- un nuovo test corretto mostra che il comportamento corrente contraddice il TODO;
- per testare serve esporre `EditorView` in una API di produzione;
- il task richiede una correzione di codice invece della sola caratterizzazione.

## Evidence richiesta

- SHA candidato;
- nomi esatti dei nuovi test;
- per ogni test, quale buco di caratterizzazione copre;
- output dei required checks.