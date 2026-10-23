# 0221 — I motori esterni si seguono da vicino: la loro toolchain, le patch a tre vie e un avviso pianificato

- **Stato:** proposta
- **Data:** 2026-10-24
- **Ambito:** sicurezza
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La [0213](0213-provenienza-dei-motori-esterni.md) fa di WordCraft e GridCraft
una copia derivata: l'upstream a uno SHA più le patch di Fub, con proprietari
chiusi e aggiornamenti decisi. La forma regge, ma l'upstream cambia più in
fretta di quanto la copia lo segua: decine di commit al giorno, un tag ogni
uno o due giorni, e una `rust-version` che sale. Tre attriti rendevano ogni
aggiornamento più caro del necessario:

- Fub pinnava una Rust più vecchia di quella dei motori, e una patch esisteva
  per riscrivere codice che la Rust di Fub non compilava;
- una patch si fermava appena l'upstream spostava un file o il contesto
  vicino, anche dove le modifiche non si toccavano;
- di ciò che Fub ricopia senza copiarlo (la barra dei fogli in TS segue
  `ui-egui/src/ribbon.rs` di GridCraft) nessuno sapeva quando cambiava.

## Decisione

- **La Rust di Fub segue i motori.** Il workspace e la CI usano almeno la
  `rust-version` più alta fra i motori copiati. `vendor.mjs report` avvisa
  quando l'upstream la alza. Una patch per compatibilità con una Rust più
  vecchia non entra.
- **Le patch si portano a tre vie.** `update` e `report` applicano la pila
  sulla revisione vecchia e la portano su quella nuova con un merge a tre vie
  per file. Una patch il cui contesto è cambiato si riscrive da sola; la
  parte su un file che l'upstream ha tolto cade e si dice; resta da rifare a
  mano soltanto un conflitto vero. `vendor.mjs self-test`, in CI, prova ogni
  esito su un upstream finto.
- **Si sorveglia ciò che non si copia.** `motori.mjs` elenca per ogni motore i
  file `osservati`; `report` dice quali l'upstream ha cambiato, insieme alle
  dipendenze nuove prese da Git.
- **Un bot che avvisa, non uno che aggiorna.** Un workflow pianificato e di
  sola lettura esegue `report` contro l'ultimo tag dell'upstream e apre o
  aggiorna una issue. Non tocca la copia e non apre PR: la revisione cambia
  ancora soltanto con una PR decisa, come dice la 0213.
- **Le patch si propongono all'upstream.** Ogni patch che non è
  `FUB-SPECIFIC` va proposta là, e la tabella del suo `UPSTREAM.md` dice a
  che punto è la proposta: è il modo più economico di togliere lavoro agli
  aggiornamenti.

La copia resta la via: il motore non è su crates.io, e i criteri della 0213
per una dipendenza Git non valgono ancora.

## Conseguenze

### Positive

- Un aggiornamento costa i conflitti veri, non gli spostamenti.
- Una classe intera di patch (compatibilità con la Rust) sparisce.
- Chi aggiorna sa prima che cosa cambia anche fuori dai file copiati.

### Negative

- La versione minima di Rust di Fub sale con quella dei motori, anche quando
  Fub da solo non ne avrebbe bisogno.
- Una patch riscritta a tre vie va riletta nel diff della PR di
  aggiornamento: il merge è meccanico, la revisione no.
- Una issue aperta dal bot è rumore se nessuno la legge.

## Alternative scartate

### Restare su una Rust più vecchia e patchare

Teneva l'MSRV di Fub basso, ma ogni aggiornamento poteva portare una patch
nuova di sola compatibilità, e nessun utente di Fub compila con una Rust
vecchia: l'MSRV è una promessa di build della CI.

### Un bot che aggiorna la copia da solo

Seguiva l'upstream senza costo umano, ma la 0213 vuole che chi aggiorna legga
cosa cambia nel codice di terzi che Fub compila. L'avviso conserva quella
lettura e ne anticipa il momento.

### Un'astrazione sopra i motori

Un trait «motore del documento» o «del foglio» permetterebbe di cambiarli,
ma non c'è un secondo motore, e i confini ci sono già: il protocollo grid a
byte, il giornale dei comandi e la proiezione rich. Tradurre ogni comando due
volte costerebbe più di quanto proteggerebbe.

## Verifica

- `node tools/vendor-craft/vendor.mjs self-test` nel job `invariants` della CI.
- `node tools/vendor-craft/vendor.mjs check`, che ricostruisce l'upstream da
  ogni copia.
- `rust-version` in `Cargo.toml` e il toolchain pinnato nei workflow.
- `.github/workflows/motori-upstream.yml`, il report pianificato.
