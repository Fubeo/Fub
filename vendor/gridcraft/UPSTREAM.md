# GridCraft vendorizzato

Questa cartella contiene codice di
[GridCraft](https://github.com/storytold/gridcraft), copiato con le poche
modifiche elencate qui sotto. Fub non dipende da GridCraft via Git:
`deny.toml` ammette soltanto crates.io, e i crate non sono pubblicati là.

Sette crate, i crate del dominio del foglio di calcolo: i tipi comuni
(`core`), il parser delle formule (`formula`), le funzioni (`functions`), i
formati numerici (`numfmt`), il modello della cartella (`model`), il calcolo
(`calc`) e i codec dei file (`xlsx`). Li usa soltanto `fub-format-xlsx`, che
legge le cartelle di Excel in sola lettura. La facciata dell'upstream
(`engine`, con sessione, comandi e cronologia), l'interfaccia (`ui-egui`), i
grafici (`chart`), il PDF (`pdf`) e il server MCP (`mcp`) non sono copiati.

## Riferimento

- repository: `https://github.com/storytold/gridcraft`
- commit: `a2cc4b42cac6e2c41bae71fba4607300755a0b47` (tag `v0.9.0`, 2026-10-19)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Modifiche |
|---|---|---|
| `crates/core/` | `crates/core/` | nessuna |
| `crates/formula/` | `crates/formula/` | nessuna |
| `crates/functions/` | `crates/functions/` | `src/engineering.rs`, per Rust 1.89 |
| `crates/numfmt/` | `crates/numfmt/` | nessuna |
| `crates/model/` | `crates/model/` | nessuna |
| `crates/calc/` | `crates/calc/` | nessuna |
| `crates/xlsx/` | `crates/xlsx/` | `src/package.rs` e sei file di `src/tests/` per `zip` 9; `src/ods.rs` per Rust 1.89 |
| `rustfmt.toml` | `rustfmt.toml` | nessuna |
| `NOTICE` | `NOTICE` | nessuna |

I manifest dei crate sono quelli dell'upstream. Ereditano versione, edizione,
licenza, lint e dipendenze da `Cargo.toml` di questa cartella, che è di Fub e
non dell'upstream: un workspace con i sette crate, fuori da quello di Fub
(`exclude` nel `Cargo.toml` radice), con il suo `Cargo.lock`. Fub prende i
crate come dipendenze a percorso, con il proprio lock; i test dell'upstream
girano qui, anche in CI:

```text
cargo test --manifest-path vendor/gridcraft/Cargo.toml --workspace --locked
```

Fuori dal workspace di Fub, i crate non passano dal suo
`cargo clippy --workspace --all-targets -- -D warnings`: i lint del workspace
di questa cartella permettono gli avvisi, che corregge l'upstream e non una
copia, e vietano soltanto `unsafe`; ogni crate dichiara già
`forbid(unsafe_code)`. Con la 1.89 di Fub, e le patch qui sotto, i crate
compilano e i loro test passano.

Le patch di `patches/`, una per ragione:

- `0001-zip-9`: l'upstream usa `zip` 3, che ha tre avvisi di sicurezza
  (RUSTSEC-2026-0367, -0368, -0369) corretti in `zip` 9. In `zip` 9 il nome di
  una voce dell'archivio è un `Result`: in `xlsx/src/package.rs` un pacchetto
  con il nome di una voce illeggibile si rifiuta con l'errore dell'archivio, e
  nei sei file di `xlsx/src/tests/` che leggono l'archivio `f.name()` diventa
  `f.name().unwrap()`;
- `0002-rust-1-89`: l'upstream dichiara `rust-version = "1.90"` ma usa
  `std::f64::consts::EULER_GAMMA`, stabile dalla 1.94, in
  `functions/src/engineering.rs`, che qui ha lo stesso valore scritto per
  esteso; in `xlsx/src/ods.rs` un `r.as_ref()` che la 1.89 non sa inferire
  (E0308) diventa `&*r`. Il codice è lo stesso sul `main` dell'upstream, e la
  dichiarazione va corretta là.

Le dipendenze del workspace di questa cartella hanno, per quelle in comune con
Fub, la stessa versione del `[workspace.dependencies]` di Fub, perché il grafo
dei due workspace sia lo stesso (lo controlla `vendor.mjs check`). Rispetto
all'upstream:

- `zip` passa da 3 a 9.0.5, per gli avvisi qui sopra;
- `serde_json` non accende `float_roundtrip`: serve soltanto ai test
  dell'upstream, e le feature si unificano in tutto il grafo di Fub.

I sette crate non portano nessuna libreria nuova nell'albero di Fub: ogni loro
dipendenza c'è già. Le righe `gridcraft-*` dei due workspace portano la
versione accanto al percorso, perché `cargo deny` non consideri jolly una
dipendenza fra crate pubblicabili.

`rustfmt.toml` sta qui per chi formatta questi file con le regole
dell'upstream. La struttura delle cartelle è la stessa dell'upstream.

## Dati inclusi e licenze

Nessun dato di terzi: il `NOTICE` dell'upstream dice che ogni risorsa è
originale di GridCraft, e i crate copiati non ne includono. I marchi di
`docs/brand/` che il `NOTICE` nomina non sono copiati.

## Aggiornare

La copia è derivata: l'upstream al commit di `upstream.lock` più le patch di
`patches/`, in ordine. Le modifiche elencate sopra sono quelle patch, una per
ragione; nessun file si modifica a mano.

```text
node tools/vendor-craft/vendor.mjs gridcraft update --rev <sha> [--tag <tag>] [--source <clone o URL>]
node tools/vendor-craft/vendor.mjs gridcraft check
node tools/vendor-craft/vendor.mjs gridcraft verify-upstream
```

I tre comandi fanno ciò che fanno per WordCraft
([`vendor/wordcraft/UPSTREAM.md`](../wordcraft/UPSTREAM.md)). Dopo un
aggiornamento: i test qui sopra, con il `Cargo.lock` di questa cartella
aggiornato (`cargo update --manifest-path vendor/gridcraft/Cargo.toml
--workspace`), quelli di `fub-format-xlsx` e di `fub-host` (test
`xlsx_workbooks`) e `cargo deny check`. Se la proiezione cambia, la fixture
della griglia si rigenera con `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx
--test ts_projection`, e il suo diff dice cosa vede di diverso la shell.

Una correzione che serve a Fub va proposta all'upstream; finché non entra,
resta una patch.

Il perché di questa forma è nell'[ADR 0213](../../docs/decisions/0213-provenienza-dei-motori-esterni.md);
il ruolo di GridCraft in Fub nell'[ADR 0214](../../docs/decisions/0214-gridcraft-motore-del-foglio-di-calcolo.md).
