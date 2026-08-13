# Spike WASM — rapporto

Misura eseguita il 2026-08-13 su `c5d3786`, con Rust/Cargo 1.97.1 e target
`wasm32-unknown-unknown` già installato. Il deliverable è questa misura: non è
stato aggiunto un runtime e non è iniziata M5.

## Esito

| Gradino | Esito | Evidenza |
| --- | --- | --- |
| Contratto verso WASM | **verde** | Il `plugin-world` completo genera i binding guest e compila in release a `wasm32-unknown-unknown`: 276.907 byte, 40,66 s a freddo in target isolata. |
| Feature verso WASM | **verde senza `search`; rosso col default** | Tutte le nove feature non-search compilano insieme. `search` trascina Tantivy → zstd → `zstd-sys`, il cui build per WASM si ferma perché non trova `clang`. |
| WIT con toolchain reale | **verde** | `wit-parser` 0.254.0 parsa contratto vivo e baseline congelata; `wit-bindgen` 0.60.0 genera 172.755 righe e il risultato compila a WASM. |
| Chiamata oltre il confine | **non misurabile nel repo attuale** | Non esistono `fub-wasm-host`, Wasmtime o un host equivalente. Il varco prova costruibilità, non una chiamata runtime. |

## 1. Il contratto compila a WASM

Comando di misura, con target dir isolata per non confondere la durata con le
altre compilazioni del workspace:

```sh
CARGO_TARGET_DIR=/tmp/varco-wasm-rel2 \
  cargo build --release \
  --manifest-path tools/varco-wasm/Cargo.toml \
  --target wasm32-unknown-unknown
```

Esito: exit 0, 40,66 s riportati da Cargo. Artefatto:

```text
/tmp/varco-wasm-rel2/wasm32-unknown-unknown/release/varco_wasm.wasm
276907 byte
```

`tools/varco-wasm/build.rs` dà il `world plugin-world` a `wit-bindgen` con
`stubs: true`: vengono compilati sia gli import sia il lifting degli export, non
solo dichiarazioni morte. La build debug usata dalla CI passa anch'essa e
produce 21.895.671 byte.

Rispetto alla misura della decisione 0146, il release cresce da 275.073 a
276.907 byte (+0,67%). Il contratto è cresciuto; anche toolchain e macchina sono
diverse. La dimensione è stabile a parità di percorso, l'hash no: il percorso
assoluto di `OUT_DIR` entra nell'artefatto.

## 2. Le feature compilano salvo la ricerca

Il crate con le feature predefinite non completa la build:

```sh
cargo check -p fub-features --target wasm32-unknown-unknown --lib
```

Esito: exit 101 nel build script di `zstd-sys 2.0.16+zstd.1.5.7`:
`cc-rs` cerca `clang` come compilatore C per WASM e non lo trova. La catena è:

```text
fub-features(search) → tantivy → tantivy-columnar → tantivy-sstable
                     → zstd → zstd-safe → zstd-sys
```

Il massimo sottoinsieme già dichiarato dal manifest e verificato senza
`search` compila:

```sh
cargo check -p fub-features \
  --target wasm32-unknown-unknown --lib --no-default-features \
  --features backlinks,blocks,commands,graph,outline,stats,tags,trash,versioning
```

Esito: exit 0, 17,93 s nella verifica finale. Quindi il contratto e le nove
feature prive di Tantivy non hanno un blocco WASM osservato. Il fallimento di
`search` è prima di `search.rs`: questa misura dimostra la dipendenza nativa,
non dimostra ancora se Tantivy funzionerebbe su `wasm32-unknown-unknown` una
volta fornito un compilatore C.

## 3. Il mirror WIT è input reale di toolchain

Non sono installate CLI autonome `wasm-tools`, `wit-bindgen` o `wasmtime`. Il
repo usa deliberatamente le librerie ufficiali Bytecode Alliance in-process:

```sh
cargo test -p fub-abi --test wit_conformance
cargo test -p fub-abi --test wit_additivity
```

Esiti: 6/6 e 4/4. `wit-parser` 0.254.0 parsa davvero
`wit/fub/abi.wit` e `wit/frozen/0.1.0.wit`; i meta-test verificano che WIT
invalido e rotture della baseline diventino rossi. `wit-bindgen` 0.60.0 genera
inoltre `plugin_world.rs` (172.755 righe, 97.455.497 byte) e il gradino 1 lo
compila. Non è un controllo testuale del mirror.

## 4. La chiamata minima non ha ancora un host

La latenza del confine, i byte copiati da una chiamata e il costo di
serializzare un `Document` non sono misurabili onestamente oggi:

- `fub-wasm-host` è ancora solo la voce commentata di M5 nel `Cargo.toml`;
- il core vieta motori quali Wasmtime/Wasmer con
  `crates/fub-abi/tests/dependency_invariant.rs`;
- `tools/varco-wasm` contiene il lato guest generato, non un host che lo
  istanzi.

I 40,66 s e i 276.907 byte sono rispettivamente costo di build a freddo e peso
del modulo minimo che implementa tutto il mondo. **Non sono latenza di una
chiamata.**

Il prerequisito minimo per il quarto gradino è quello già assegnato a M5: un
`fub-wasm-host` fuori dal core, basato sul component model, che carichi un guest
`wasm32-wasip2` e faccia almeno un round-trip di un tipo del contratto. Solo lì
si possono contare lowering/lifting, copie e tempo per invocazione.

## Conseguenza per il freeze

La forma del contratto supera il rischio verificabile prima del runtime: è WIT
valido, resta additiva, genera tutti i binding e compila di là dal confine. Il
freeze non deve però trasformare questa prova in una promessa di prestazioni:
la costruibilità è verde; economia, capability e isolamento runtime restano
criteri di accettazione di M5.
