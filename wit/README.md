# `wit/` — contratto WIT di FubMD

Questo albero contiene il contratto **WIT** che rispecchia `fubmd-abi`. Serve a
rendere **verificabile** la regola d'oro del progetto: ogni tipo che attraversa la
firma di un trait è esprimibile come record/variant/enum WIT, così che il runtime
WASM di [M5](../docs/milestones/M5-wasm-runtime.md) sia meccanico e non una rincorsa
a firme non serializzabili.

- Contratto: [`fubmd/abi.wit`](fubmd/abi.wit) — package `fubmd:abi@0.1.0`.
- Contratto **com'era**, versione per versione: [`frozen/`](frozen/README.md).
- Mapping tipo-abi → costrutto WIT: [docs/architecture/traits.md](../docs/architecture/traits.md).
- Modello dati: [docs/architecture/data-model.md](../docs/architecture/data-model.md).

## Ciclo di vita ("vivo da M2, freeze a M4")

- **Da M2 (ora):** il WIT è mantenuto **vivo** insieme a `fubmd-abi`. Un test di
  conformità gira ad ogni `cargo test` e rompe se i due divergono. La superficie è
  ancora libera di evolvere.
- **A [M4](../docs/milestones/M4-wit-hardening.md):** la superficie viene
  **congelata**; da lì i cambi sono additivi e versionati, i breaking richiedono un
  bump del package.

## Conformità: com'è verificata

Test: [`crates/fubmd-abi/tests/wit_conformance.rs`](../crates/fubmd-abi/tests/wit_conformance.rs).

Il test **parsa** `abi.wit` con `wit-parser` e confronta nomi **e tipi**
*dichiarati*, non sottostringhe del sorgente. `wit-parser` è una
**dev-dependency**: l'invariante di `fubmd-abi` riguarda le dipendenze normali
(quelle che finiscono nella libreria), ed è presidiata dal suo test in
[`dependency_invariant.rs`](../crates/fubmd-abi/tests/dependency_invariant.rs).

Pressione su **quattro** direzioni:

1. **Il WIT deve essere valido →** un contratto che non parsa è un test rosso.
   (Prima non lo era: il WIT era sintatticamente invalido e il test verde.)
2. **Drift lato Rust →** match e destructuring esaustivi su ogni tipo di
   `fubmd-abi` non compilano più se un enum guadagna una variante o un campo
   cambia; e le funzioni sono **cast dei metodi dei trait a puntatore a
   funzione**, quindi non compilano se un parametro o un tipo di ritorno cambia.
   Il compilatore obbliga ad aggiornare il test (e quindi il WIT).
3. **Drift lato WIT, nelle due direzioni →** un tipo/caso/campo/parametro atteso
   e assente fallisce; uno dichiarato nel WIT e che nessun tipo abi rivendica
   fallisce ugualmente, perché è contratto morto. Si confrontano anche i **tipi**
   (campi in ordine, payload dei casi, firme complete) e l'**ordine**: in un
   record è la disposizione al confine, in un variant è il discriminante.
4. **`host` è eliso →** nessuna funzione del WIT può avere un parametro `host`,
   anche là dove il metodo Rust prende un `&mut dyn HostApi`: le capacità si
   importano dal world (`import host-api`), non si passano come argomento.

I tipi attesi **non sono scritti a mano**: si deducono dai tipi Rust
(`wit(&campo)` sul campo destrutturato, `WitFn` sul puntatore a funzione). Se
`SearchHit::score` diventasse `f64`, l'attesa diventerebbe `f64` e il confronto
col contratto (`f32`) fallirebbe.

C'è anche il **test del test**: quattordici divergenze introdotte ad arte — campo
rinominato, caso rimosso, funzione sparita, tipo di troppo, alias con la
larghezza sbagliata, tipo di un campo o di un payload cambiato, risultato di una
funzione cambiato, parametro rinominato o ritipato, `host` riapparso, campi e
casi riordinati — devono tutte farlo diventare rosso, o non sta verificando
niente.

## Additività: l'altra promessa, l'altro test

Test: [`crates/fubmd-abi/tests/wit_additivity.rs`](../crates/fubmd-abi/tests/wit_additivity.rs).

La conformità dice che abi e WIT concordano **oggi, fra di loro**. Non dice
niente su ieri: si può rinominare un campo in tutti e due, restare conformi, e
aver rotto ogni plugin già compilato. E `abi_compatible` — la regola a runtime —
in quel caso dice **sì**, perché la minor non è cambiata.

Il presidio è una copia del contratto per ogni versione pubblicata in
[`frozen/`](frozen/README.md), più un test che verifica che il contratto attuale
sappia ancora servire ognuna di quelle che dichiara di servire: campi, casi,
alias, firme e world già pubblicati devono essere intatti **e nella stessa
posizione**; il nuovo può stare solo in coda. Regole complete, e come si aggiorna
la linea di base, in [`frozen/README.md`](frozen/README.md).

## Convenzioni

- I nomi WIT sono in **kebab-case**; corrispondono ai nomi Rust (le varianti serde
  usano già `rename_all = "snake_case"`, che mappa 1:1 sul kebab WIT).
- I valori JSON liberi — frontmatter, `attrs` dell'escape hatch `Custom`, argomenti
  dei comandi, storage dei plugin — attraversano il confine come `type json =
  string`. Scelta deliberata per preservare la flessibilità dell'escape hatch; da
  confermare al freeze di M4.
- I payload di variante con più campi usano record ausiliari (`block-heading`,
  `link-target-wiki`, `ui-stack`, …) perché una `variant` WIT porta un solo tipo per
  caso.
- Gli **alberi ricorsivi** (`block`, `inline`, `ui-node`) al confine sono
  un'**arena**: lista piatta di nodi + indici `u32` (`block-ref`, `inline-ref`,
  `ui-ref`), perché WIT non ammette tipi ricorsivi. I tipi Rust nativi restano
  alberi; la conversione è `fubmd_abi::arena` (round-trip, indici fuori range e
  cicli sotto test), e il proxy WASM di M5 la chiamerà invece di riscriverla. Il
  perché — e perché non una stringa JSON — è in
  [docs/architecture/traits.md](../docs/architecture/traits.md),
  "Alberi ricorsivi al confine".
- `list`, `result` e `from` sono **keyword WIT**: dove sono nomi di variante o di
  campo compaiono con l'escape `%`. I nomi Rust non cambiano.
