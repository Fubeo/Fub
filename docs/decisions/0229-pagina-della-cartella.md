# 0229 — La pagina della cartella è `_index`

- **Stato:** proposta
- **Data:** 2026-10-29
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

L'explorer apriva come nota di una cartella `X/X.<ext>`, e in mancanza
`X/index.<ext>`, la regola di make.md e del plugin «folder notes» di Obsidian.
Funzionava a metà: `Viaggio/Viaggio.md` è anche una nota qualsiasi che porta il
nome della sua cartella, e chi la scriveva senza volerne fare la pagina se la
vedeva sparire dalla lista dei figli. `index` invece si chiamava «index» in
schede, ricerca, grafo e `[[…]]`, cioè non come la cartella.

La modalità Blocchi fa delle cartelle delle pagine con sottopagine, alla
Notion: alla pagina serve un nome di file che nessuno dà per caso a una nota, e
un nome che sia quello della cartella dappertutto.

## Decisione

1. **La pagina di una cartella `X` è `X/_index.<ext>`**, per ogni estensione
   che un provider registra. Il nome si confronta esatto: `_Index.md` è una
   nota come le altre.
2. **Il suo nome pagina è il nome della cartella.** `DocId::page_name()` in
   `fub-abi` lo dice per tutti: risoluzione dei wikilink, riscrittura alla
   rinomina, titolo nelle schede, ricerca, grafo, export. La gemella del client
   (`pageName` in `apps/client/src/rules/mirrored.ts`) è provata sugli stessi
   casi dalla fixture di `rules_mirror`.
3. **Alla radice del vault `_index.<ext>` resta una nota normale**: la radice
   non è una cartella con un nome.
4. **`X/X.<ext>` e `X/index.<ext>` diventano note normali.** Fub non rinomina
   niente da solo. Un'opzione delle Preferenze, spenta, li riconosce ancora come
   pagina dopo `_index`, e il comando «Usa come pagina della cartella» rinomina
   una nota in `_index` su richiesta, senza mai sovrascrivere una pagina che c'è
   già.
5. **Un omonimo resta un omonimo.** `Viaggio/_index.md` e `Altro/Viaggio.md`
   contendono «Viaggio» come due note qualsiasi, con la regola di sempre.

## Conseguenze

### Positive

- `[[Viaggio]]` porta alla pagina della cartella, e alla rinomina della
  cartella diventa `[[Vacanze]]` come per una nota;
- una nota omonima della sua cartella non sparisce più dalla lista.

### Negative

- i vault che usano `X/X.md` cambiano aspetto finché non si accende l'opzione o
  non si usa il comando;
- negli altri programmi la pagina si chiama «_index».

## Alternative scartate

### `X/X.md` come prima

È la convenzione più diffusa, ma confonde la pagina con una nota omonima, ed è
il caso che la modalità Blocchi rende comune.

### `X/index.md`

È il nome dei generatori di siti, ma `index` è anche un nome da nota, e
cambiarne il nome pagina avrebbe cambiato i link di chi lo usava così.

## Verifica

- `crates/fub-abi/tests/rules_mirror.rs` e
  `apps/client/src/__fixtures__/rules-samples.json`: il nome della pagina, la
  radice, maiuscole, estensioni, NFD;
- `crates/fub-features/tests/folders_e2e.rs`: `[[Viaggio]]` trova
  `Viaggio/_index.md`, la rinomina della cartella riscrive i link, l'omonimo e
  `_index.md` alla radice;
- `crates/fub-host/tests/svg_vault.rs` e
  `apps/client/src/rules/organizer.test.ts`: la pagina nell'albero, con e senza
  i vecchi nomi.
