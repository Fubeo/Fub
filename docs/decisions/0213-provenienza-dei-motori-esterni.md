# 0213 — I motori esterni sono una copia derivata, con proprietari e aggiornamenti decisi

- **Stato:** accolta
- **Data:** 2026-10-21
- **Ambito:** sicurezza
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La [0209](0209-videoscrittura-come-proiezione.md) vendorizza il modello e il
codec di WordCraft in `vendor/wordcraft/`. La copia era fatta a mano: i
manifest riscritti, alcune modifiche al sorgente per i lint di Fub, e nessun
modo di dire, dato un file, se veniva dall'upstream o da una modifica locale.
L'upstream cambia molto in fretta, e chi aggiorna deve sapere cosa cambia nel
codice di terzi che Fub compila.

`deny.toml` ammette soltanto crates.io, e i crate di WordCraft non sono
pubblicati là. Una dipendenza Git, dall'upstream o da una fork, sposterebbe le
feature e le dipendenze nel workspace dell'upstream.

## Decisione

- **La copia è derivata.** `vendor/wordcraft/` è l'upstream al commit di
  `upstream.lock` più le patch di `patches/`, in ordine, una per ragione.
  `tools/vendor-craft/vendor.mjs wordcraft update` la rigenera, `check` (in CI) la
  ricostruisce all'indietro fino alle impronte dell'upstream. Nessun file si
  modifica a mano.
- **I manifest sono dell'upstream.** I sei crate stanno in un workspace loro,
  fuori da quello di Fub, con il loro `Cargo.lock` e i loro test in CI. Le
  scelte di Fub (versioni allineate, feature di `image`, `zip` 9) stanno nel
  `Cargo.toml` di quel workspace, che è di Fub.
- **Proprietari chiusi.** Il motore entra in Fub soltanto da
  `fub-format-rich` e dal correttore di `fub-features` (feature `proof`);
  `fub-host` lo usa soltanto nei test. Un terzo proprietario si decide
  cambiando l'elenco dei proprietari, non con un import.
- **Aggiornamenti decisi.** La revisione cambia soltanto con una PR che la
  cambia, nessun bot: preferibilmente un tag dell'upstream, scritto come SHA
  completo. Il motore non si aggiorna mai con correzioni nel codice copiato:
  gli errori si correggono negli adattatori, e una correzione che serve a Fub
  si propone all'upstream e resta una patch finché non entra.
- **Fork e Git si rivalutano con criteri.** Una dipendenza Git, dall'upstream o
  da una fork sotto `Fubeo`, diventa sensata soltanto quando non resta nessuna
  patch di Fub, i manifest dell'upstream vanno bene così, la versione minima
  di Rust è compatibile, esiste un mirror protetto, la build offline è provata,
  `cargo deny` ammette soltanto quell'URL e due aggiornamenti consecutivi sono
  passati senza modifiche a mano. Se l'upstream pubblica i crate su
  crates.io, la dipendenza normale da crates.io sostituisce la copia.
- In ogni caso la garanzia della [0212](0212-preservazione-misurata-sul-pacchetto.md),
  il corpus e i confini restano.

## Conseguenze

### Positive

- Una differenza fra la copia e l'upstream è una patch con la sua ragione, e
  la CI fallisce su ogni altra.
- Un aggiornamento è un comando e una lista di controllo, con il diff delle
  dipendenze stampato.
- Gli avvisi del codice di terzi non bloccano la CI di Fub, e i test
  dell'upstream girano come l'upstream li scrive.

### Negative

- Il codice di WordCraft non passa dai lint di Fub: lo verificano i suoi test
  e la garanzia, non clippy.
- Per i difetti del codice di WordCraft non esiste un avviso automatico: si
  leggono le note di versione a ogni aggiornamento. Per le librerie di
  crates.io che usa, gli avvisi arrivano da `cargo deny`.
- Due `Cargo.lock` da tenere allineati.

## Alternative scartate

### Dipendenza Git pinnata, o da una fork

Toglieva la copia, ma Fub ha ancora patch di sorgente, la versione
minima di Rust dell'upstream è più alta e `deny.toml` dovrebbe ammettere una
sorgente Git. Resta l'esito previsto quando i criteri valgono.

### La copia scritta a mano

Era lo stato di prima: nessuna prova che un file venisse dall'upstream, e un
aggiornamento che riscriveva i manifest ogni volta.

## Verifica

- `node tools/vendor-craft/vendor.mjs wordcraft check`, nel job delle invarianti
  della CI;
- `cargo test --manifest-path vendor/wordcraft/Cargo.toml --workspace --locked`,
  nel job dei test;
- `crates/fub-abi/tests/dependency_invariant.rs`: i proprietari
  (`WORDCRAFT_OWNERS`), il nucleo che non raggiunge il motore e il diagramma
  delle dipendenze;
- `.github/scripts/check-engine-boundary.mjs`: nessun import del motore
  fuori dai proprietari;
- `cargo deny check`, nel job della supply chain.
