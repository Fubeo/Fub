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

Il test **parsa** `abi.wit` con `wit-parser` e confronta insiemi di nomi
*dichiarati*, non sottostringhe del sorgente. `wit-parser` è una
**dev-dependency**: l'invariante di `fubmd-abi` riguarda le dipendenze normali
(quelle che finiscono nella libreria), ed è presidiata dal suo test in
[`dependency_invariant.rs`](../crates/fubmd-abi/tests/dependency_invariant.rs).

Pressione su **tre** direzioni:

1. **Il WIT deve essere valido →** un contratto che non parsa è un test rosso.
   (Prima non lo era: il WIT era sintatticamente invalido e il test verde.)
2. **Drift lato Rust →** match e destructuring esaustivi su ogni tipo di
   `fubmd-abi` non compilano più se un enum guadagna una variante o un campo
   cambia: il compilatore obbliga ad aggiornare il test (e quindi il WIT).
3. **Drift lato WIT, nelle due direzioni →** un tipo/caso/campo atteso e assente
   fallisce; uno dichiarato nel WIT e che nessun tipo abi rivendica fallisce
   ugualmente, perché è contratto morto.

C'è anche il **test del test**: divergenze introdotte ad arte (campo rinominato,
caso rimosso, funzione sparita, tipo di troppo, alias con la larghezza sbagliata)
devono farlo diventare rosso, o non sta verificando niente.

### Limite noto (colmato a M4)

Si confrontano i **nomi** di tipi, casi, campi e funzioni, e i **tipi** dei soli
alias (dove il tipo *è* l'informazione: gli indici dell'arena sono `u32`, gli
span `u64`). I tipi dei campi di record e le firme complete delle funzioni sono
lavoro di [M4](../docs/milestones/M4-wit-hardening.md), dove arriva anche la
generazione di binding con `wit-bindgen` + conversioni `From`/`Into` che non
compilano su divergenza di forma. Quel tooling vivrà in un crate al confine
(`fubmd-wasm-host` o un crate di conformità dedicato), **mai** fra le dipendenze
normali di `fubmd-abi`/`fubmd-kernel`.

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
  `ui-ref`), perché WIT non ammette tipi ricorsivi. I tipi Rust restano alberi;
  la conversione vive nel proxy WASM. Il perché — e perché non una stringa JSON
  — è in [docs/architecture/traits.md](../docs/architecture/traits.md),
  "Alberi ricorsivi al confine".
- `list`, `result` e `from` sono **keyword WIT**: dove sono nomi di variante o di
  campo compaiono con l'escape `%`. I nomi Rust non cambiano.
