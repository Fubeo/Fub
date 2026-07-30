# `wit/` — contratto WIT di Fub

L'albero che contiene il contratto **WIT** rispecchiante `fub-abi`. Serve a
rendere **verificabile** la regola d'oro: ogni tipo che attraversa la firma di un
trait è esprimibile come record/variant/enum WIT, così che il runtime WASM di
[M5](../milestones/M5-wasm-runtime.md) sia meccanico e non una rincorsa a firme
non serializzabili.

- Contratto: [`fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit) — package `fub:abi@0.1.0`.
- Contratto **com'era**, versione per versione: [`frozen/`](wit-congelato.md).
- Mapping tipo-abi → costrutto WIT: [traits.md](traits.md).
- Modello dati: [data-model.md](data-model.md).

## Ciclo di vita ("vivo da M2, freeze a M4")

- **Da M2 (ora):** il WIT è mantenuto **vivo** insieme a `fub-abi`. Un test di
  conformità gira a ogni `cargo test` e rompe se i due divergono. La superficie è
  ancora libera di evolvere.
- **A [M4](../milestones/M4-wit-hardening.md):** la superficie viene
  **congelata**; da lì i cambi sono additivi e versionati, i breaking richiedono
  un bump del package.

## Conformità

Test: [`crates/fub-abi/tests/wit_conformance.rs`](../../crates/fub-abi/tests/wit_conformance.rs).

Parsa `abi.wit` con `wit-parser` e confronta nomi **e tipi** *dichiarati*, non
sottostringhe del sorgente. `wit-parser` è una **dev-dependency**: l'invariante
di `fub-abi` riguarda le dipendenze normali, presidiate da
[`dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs).

Le quattro direzioni di pressione, i tipi attesi dedotti invece che scritti a
mano e il test-del-test (quattordici divergenze introdotte ad arte) sono
descritti in [traits.md](traits.md), "Come la conformità è verificata".

## Additività: l'altra promessa, l'altro test

Test: [`crates/fub-abi/tests/wit_additivity.rs`](../../crates/fub-abi/tests/wit_additivity.rs).

La conformità dice che abi e WIT concordano **oggi, fra di loro**. Non dice
niente su ieri: si può rinominare un campo in tutti e due, restare conformi, e
aver rotto ogni plugin già compilato — e `abi_compatible`, la regola a runtime,
in quel caso dice **sì**, perché la minor non è cambiata.

Il presidio è una copia del contratto per ogni versione pubblicata in
[`frozen/`](wit-congelato.md), più un test che verifica che il contratto attuale
sappia ancora servire ognuna di quelle che dichiara di servire: campi, casi,
alias, firme e world già pubblicati devono essere intatti **e nella stessa
posizione**; il nuovo può stare solo in coda. Regole complete, e come si aggiorna
la linea di base, in [`frozen/README.md`](wit-congelato.md).

## Convenzioni

- I nomi WIT sono in **kebab-case**; corrispondono ai nomi Rust (le varianti
  serde usano già `rename_all = "snake_case"`, che mappa 1:1 sul kebab WIT).
- I valori JSON liberi — frontmatter, `attrs` dell'escape hatch `Custom`,
  argomenti dei comandi, storage dei plugin — attraversano il confine come
  `type json = string`. Scelta deliberata per preservare la flessibilità
  dell'escape hatch; da confermare al freeze di M4.
- I payload di variante con più campi usano record ausiliari (`block-heading`,
  `link-target-wiki`, `ui-stack`, …) perché una `variant` WIT porta un solo tipo
  per caso.
- Gli **alberi ricorsivi** (`block`, `inline`, `ui-node`) al confine sono
  un'**arena**: lista piatta di nodi + indici `u32` (`block-ref`, `inline-ref`,
  `ui-ref`), perché WIT non ammette tipi ricorsivi. I tipi Rust nativi restano
  alberi; la conversione è `fub_abi::arena`, e il proxy WASM di M5 la chiamerà
  invece di riscriverla. Il perché — e perché non una stringa JSON — è in
  [traits.md](traits.md), "Alberi ricorsivi al confine".
- `list`, `result` e `from` sono **keyword WIT**: dove sono nomi di variante o di
  campo compaiono con l'escape `%`. I nomi Rust non cambiano.
