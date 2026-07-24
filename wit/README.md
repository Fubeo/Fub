# `wit/` — contratto WIT di FubMD

Questo albero contiene il contratto **WIT** che rispecchia `fubmd-abi`. Serve a
rendere **verificabile** la regola d'oro del progetto: ogni tipo che attraversa la
firma di un trait è esprimibile come record/variant/enum WIT, così che il runtime
WASM di [M5](../docs/milestones/M5-wasm-runtime.md) sia meccanico e non una rincorsa
a firme non serializzabili.

- Contratto: [`fubmd/abi.wit`](fubmd/abi.wit) — package `fubmd:abi@0.1.0`.
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

È un check **strutturale** e **std-only** (nessuna dipendenza aggiuntiva —
l'invariante di `fubmd-abi` resta intatto). Crea pressione **bidirezionale**:

1. **Drift lato Rust →** match e destructuring esaustivi su ogni tipo di
   `fubmd-abi` non compilano più se un enum guadagna una variante o un campo
   cambia: il compilatore obbliga ad aggiornare il test (e quindi il WIT).
2. **Drift lato WIT →** ogni nome atteso (tipo, variante, campo in kebab-case) deve
   comparire in `abi.wit`: rinominare o rimuovere qualcosa rende il test rosso.

### Limite noto (colmato a M4)

Il check verifica la **presenza dei nomi**, non che il WIT sia sintatticamente
valido né che le *forme* (tipi dei campi, cardinalità) combacino. La validazione
piena — parsing con `wit-parser` e/o generazione di binding con `wit-bindgen` +
conversioni `From`/`Into` che non compilano su divergenza di forma — è parte del
lavoro di [M4](../docs/milestones/M4-wit-hardening.md). Quel tooling vivrà in un
crate al confine (`fubmd-wasm-host` o un crate di conformità dedicato), **mai** in
`fubmd-abi`/`fubmd-kernel`.

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
