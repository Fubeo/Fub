# Workflow di sviluppo

> **Per chi:** chi prepara una modifica al codice o alla documentazione.
> **Risultato:** una PR piccola, verificata e coerente con i confini.

La fonte autorevole dei comandi è [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
Questa pagina spiega l'ordine del lavoro.

## 1. Definire il confine

Prima di scrivere codice, rispondi:

- qual è il comportamento osservabile?
- chi possiede la regola?
- esiste già una porta generica?
- cambia un contratto pubblico o persistente?
- qual è il test più basso che può dimostrarlo?

Se la risposta richiede più crate, consulta
[`../architecture/components-and-boundaries.md`](../architecture/components-and-boundaries.md).

## 2. Creare un branch

```bash
git switch main
git pull --ff-only
git switch -c tipo/descrizione-breve
```

Non mescolare refactor, feature e aggiornamenti non collegati.

## 3. Lavorare dal test più vicino

Ordine consigliato:

1. test unitario della regola;
2. implementazione minima;
3. test di integrazione del confine;
4. aggiornamento della pagina canonica;
5. controllo completo dell'area.

Un bug corretto soltanto da un test end-to-end resta difficile da localizzare.
Un contratto testato soltanto in un modulo può divergere al confine.

## 4. Verificare durante il lavoro

### Rust

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### Frontend

```bash
cd apps/client
npm run typecheck
npm test
npm run build
```

### Documentazione

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-doc-orphans.mjs
node .github/scripts/check-doc-size.mjs
node .github/scripts/check-mermaid.mjs
node .github/scripts/check-markdown-style.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
```

## 5. Cambi trasversali

### Contratto

Aggiorna insieme:

- tipo Rust;
- WIT, quando attraversa il component model;
- proiezione IPC, quando attraversa Tauri;
- fixture e test di conformità;
- snapshot congelato soltanto secondo le regole di compatibilità;
- riferimento tecnico;
- ADR se cambia una scelta costosa.

### Persistenza

Dichiara:

- autorità del file;
- versione dello schema;
- comportamento su versione futura;
- migrazione o ricostruzione;
- atomicità;
- test di dati corrotti e interruzione.

### Frontend

Mantieni Tauri nel seam, assegna un owner a listener e disposer, verifica
type-check, test, build, resa e accessibilità quando cambia l'interfaccia.

### Runtime WASM

Costruisci il componente dai sorgenti. Verifica successo, capability negata,
timeout, memoria, trap, teardown e compatibilità ABI.

## 6. Commit

Formato:

```text
tipo(scope): frase in italiano
```

Il messaggio dice che cosa cambia e perché è significativo. Non usa una lista di
file come titolo.

## 7. Pull request

La descrizione contiene:

- problema;
- soluzione;
- contratti e confini toccati;
- test eseguiti;
- issue;
- rischi e migrazioni;
- screenshot o artifact, se cambia la resa.

Non dichiarare “tutto verde” senza aver verificato il commit della PR.

## 8. Dopo il merge

- le attività residue restano issue, non paragrafi “da fare” nella guida;
- la pagina di progetto viene aggiornata soltanto se cambia lo stato;
- una milestone conclusa viene rimossa dalla documentazione viva;
- il changelog riceve il risultato al momento del rilascio.
