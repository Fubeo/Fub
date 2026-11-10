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

### Contesto

Tieni nel contesto solo ciò che può cambiare la conclusione: parti dai percorsi
e dai simboli probabili, non mappare tutta la repository senza un motivo
concreto. Non riversare log enormi, diff, file generati o alberi di dipendenze
quando una vista mirata basta; non troncare una diagnostica che può servire,
recuperala quando serve. Non rileggere file o comandi senza cambiamenti per
rassicurazione. Ferma l'esplorazione quando la prova basta per il passo
successivo.

## 4. Verificare durante il lavoro

### Rust

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Mentre iteri usa il controllo più stretto che dà un segnale:

```bash
cargo test -p <crate>                 # un crate
cargo test -p <crate> --test <file>   # un file di test d'integrazione
cargo test -p <crate> --lib <modulo>::  # i test unitari di un modulo
```

### Frontend

```bash
cd apps/client
npm run typecheck
npm test
npm run build
npx vitest run <file>     # un file di test
npx vitest run -t "<nome>"  # i test che corrispondono a un nome
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
node .github/scripts/check-locale-loop.mjs
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

### Riuso di codice da altri progetti

Vale per WordCraft e progetti simili.

- Riusa prima di riscrivere: cerca un crate, una porta, un registry o un helper
  esistente, qui o a monte.
- Le funzioni di scrittura (correzione, dizionario, comandi) restano
  indipendenti dai formati: un formato porta un adattatore, mai una copia
  divergente della funzione. Nessun plugin dipende dai dettagli privati di un
  altro: solo dai suoi comandi registrati, dalle route di `query_index`, dalle
  impostazioni e dalle view.
- Il Markdown resta nativo: non dipende da DOCX né da un altro provider.
- Usa i registry e i contratti esistenti (`inventory.rs`, `HostWiring`,
  `SurfaceEditorActions`, la barra del formato, gli id dei comandi) e tieni
  stabili gli id pubblici.
- Il codice di terzi sta in `vendor/<progetto>/` con un `UPSTREAM.md` (repo,
  SHA del commit, licenza, ogni patch locale); `cargo deny check` deve passare.
  Licenza e politica della supply chain non si cambiano senza chiedere.
- Prova il riuso davvero: funzione accesa e spenta (`--no-default-features`),
  un formato spento mentre la funzione condivisa continua a funzionare, e il
  teardown di ogni registrazione a mount e unmount.

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
