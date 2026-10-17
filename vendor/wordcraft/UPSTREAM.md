# WordCraft vendorizzato

Questa cartella contiene codice e dati di
[WordCraft](https://github.com/storytold/wordcraft), copiati con le poche
modifiche al sorgente elencate qui sotto. Fub non dipende da WordCraft via Git:
`deny.toml` ammette soltanto crates.io, e i crate non sono pubblicati là.

Quattro crate: il correttore (`proof`) e, per i documenti di Word, il modello
del documento (`doc`), le sue unità di misura (`geom`) e il codec DOCX
(`docx`).

## Riferimento

- repository: `https://github.com/storytold/wordcraft`
- commit: `eae242176108d328c5dd81fbc10370c51ab90706` (2026-10-15)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Modifiche |
|---|---|---|
| `crates/proof/src/` | `crates/proof/src/` | due, sotto |
| `crates/proof/Cargo.toml` | `crates/proof/Cargo.toml` | manifest, sotto |
| `crates/geom/` | `crates/geom/` | `src/lib.rs` (la condizione sui test), manifest |
| `crates/doc/` | `crates/doc/` | `src/lib.rs` (la condizione sui test), manifest |
| `crates/docx/` | `crates/docx/` | `src/lib.rs` (la condizione sui test e due esportazioni), `src/package.rs` e sei file di `tests/` per `zip` 9, `src/write/settings_merge.rs` e `src/write/mod.rs` (una verifica in più), manifest |
| `assets/hyphenation/` | `assets/hyphenation/` | nessuna |
| `assets/spelling/` | `assets/spelling/` | nessuna |
| `rustfmt.toml` | `rustfmt.toml` | nessuna |

Le modifiche al sorgente servono a passare
`cargo clippy --workspace --all-targets -- -D warnings` della CI di Fub, dove
`-D warnings` sulla riga di comando vince sui `[lints]` del manifest, e
`cargo deny check`; una sola aggiunge una funzione, ed è l'ultima della lista:

- `src/lib.rs` di ogni crate: il `#![deny(clippy::unwrap_used, …)]` dell'upstream diventa
  `#![cfg_attr(not(test), deny(…))]`. Il codice di libreria resta vietato come
  nell'upstream; i test dell'upstream usano `unwrap()` e senza la condizione non
  compilano sotto `--all-targets`;
- `src/ru/mod.rs`: nel ramo `[prefix, rest]` di una parola col trattino, la
  variabile mai letta `rest` diventa `_`. Il comportamento non cambia;
- `docx/src/package.rs`: l'upstream usa `zip` 3, che ha tre avvisi di sicurezza
  (RUSTSEC-2026-0367, -0368, -0369) corretti in `zip` 9. In `zip` 9 il nome di
  una voce dell'archivio è un `Result`: una voce dal nome illeggibile si salta
  con un avviso nel log, come l'upstream fa già con una voce illeggibile;
- `docx/tests/*.rs`: per la stessa ragione `f.name()` diventa
  `f.name().unwrap()` nei sei file di test che leggono l'archivio;
- `docx/src/write/settings_merge.rs`: la funzione nuova `kept_unowned`, con il
  suo test, dice se una parte `settings.xml` scritta conserva, byte per byte,
  ogni figlio di `w:settings` che il modello non tiene e che `merge` dichiara
  di conservare. La esportano `src/write/mod.rs` e `src/lib.rs` come
  `settings_kept_unowned`, insieme alla chiave `SETTINGS_ORIG` della copia
  originale. Serve a `fub-format-rich`, che rifiuta di scrivere un documento
  che perderebbe impostazioni in silenzio; il resto del codec non cambia.

I manifest scrivono per esteso i campi che l'upstream eredita dal suo
workspace, tengono i lint dell'upstream e dichiarano `rust-version = "1.89"`,
quella di Fub: i crate compilano e passano i test con la 1.89. Le dipendenze
che Fub ha già, o che più crate copiati condividono, prendono la versione dal
`[workspace.dependencies]` di Fub, come chiede `check-cargo-versions.mjs`.
Rispetto all'upstream:

- `zip` passa da 3 a 9.0.5, per gli avvisi qui sopra;
- `serde_json` non accende `float_roundtrip`: le feature si unificano in tutto
  il workspace, e la libreria lo usa solo per leggere un colore, senza numeri
  in virgola mobile;
- `image`, che serve solo ai test, accende soltanto `png`, l'unico formato che
  i test scrivono;
- manca la dipendenza di `getrandom` per `wasm32`: Fub compila questi crate
  soltanto per il desktop.

Le dipendenze crittografiche del codec (`aes`, `sha1`, `sha2`, `hmac`, `cfb`)
servono ad aprire e scrivere documenti protetti da password e restano alle
versioni dell'upstream. `tauri-codegen` e `infer` ne tirano versioni più vecchie
solo in fase di compilazione di `fub-app`: `cargo deny` le segnala come doppie,
con la politica `warn` di Fub.

Un aggiornamento che porta avvisi nuovi fa fallire clippy nella CI: è il punto
in cui leggerli, non un controllo da spegnere.

`rustfmt.toml` sta qui perché `cargo fmt --all --check` di Fub formatti questi
file con le regole dell'upstream, non con quelle di Fub. La struttura delle
cartelle è la stessa dell'upstream, così gli `include_bytes!` del crate
(`../../../assets/…`) restano validi senza toccarli.

## Dati inclusi e licenze

Le licenze vengono da `ATTRIBUTION.md` e `NOTICE` dell'upstream; le impronte
sono state ricalcolate sui file copiati.

| File | Origine | Licenza | SHA-256 |
|---|---|---|---|
| `assets/hyphenation/en-us.dic` | Moby Hyphenator II di Grady Ward (Project Gutenberg #3204), convertito dai contributori di DesignCraft | pubblico dominio | `66ce9023…df63f1` |
| `assets/hyphenation/en-us.pat` | pattern addestrati dalla lista Moby dai contributori di DesignCraft | CC0-1.0 | `0ad44763…88b8` |
| `assets/hyphenation/it.pat` | `hyph-it.tex` di hyph-utf8, Claudio Beccari | MIT (offerto anche sotto LPPL 1.3+) | `6ce56ed6…6a47` |
| `assets/hyphenation/pl.pat` | `hyph-pl.tex` di hyph-utf8, Kołodziejska, Jackowski, Ryćko | MIT | `83ddbbd2…8843` |
| `assets/hyphenation/pt.pat` | `hyph-pt.tex` di hyph-utf8, de Rezende, Dias Almeida, Araujo, Benevides | BSD-3-Clause | `c110a39e…41f2` |
| `assets/spelling/en-extra.txt` | scritto dai contributori di WordCraft | MIT OR Apache-2.0 | `33805dd7…dd57` |
| `assets/spelling/ru-extra.txt` | scritto dai contributori di WordCraft | MIT OR Apache-2.0 | `12ca009a…9505` |

Le note di copyright dei pattern TeX sono nell'intestazione di ogni file.

## Cosa non è incluso

I dizionari Hunspell (`it_IT`, `pl_PL`, `pt_BR`, `ru_RU`, `cs_CZ`, `hr_HR`,
`tr_TR`) non sono inclusi, come nell'upstream: il dizionario italiano è sotto
GPL. Il crate li legge dal sistema quando ci sono; senza, la lingua non ha
segni d'ortografia ma conserva le regole grammaticali.

## Aggiornare

1. scegli un commit dell'upstream e confronta `crates/` e `assets/` con
   questa copia;
2. copia i file cambiati e riapplica le modifiche elencate qui sopra, se
   l'upstream non le contiene già;
3. riporta nel `Cargo.toml` qui le dipendenze nuove dell'upstream;
4. aggiorna commit e impronte in questa pagina;
5. esegui `cargo test -p wordcraft-proof -p wordcraft-geom -p wordcraft-doc
   -p wordcraft-docx -p fub-format-rich`, i test di `fub-features` con la
   feature `proof` e `cargo deny check`.

Una correzione che serve a Fub va proposta all'upstream; finché non entra, va
elencata nella tabella delle modifiche qui sopra.
