# WordCraft vendorizzato

Questa cartella contiene codice e dati di
[WordCraft](https://github.com/storytold/wordcraft), copiati con due modifiche
al sorgente, elencate qui sotto. Fub non dipende da WordCraft via Git: `deny.toml` ammette soltanto
crates.io, e il crate non è pubblicato là.

## Riferimento

- repository: `https://github.com/storytold/wordcraft`
- commit: `eae242176108d328c5dd81fbc10370c51ab90706` (2026-10-15)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Modifiche |
|---|---|---|
| `crates/proof/src/` | `crates/proof/src/` | due, sotto |
| `crates/proof/Cargo.toml` | `crates/proof/Cargo.toml` | campi del workspace scritti per esteso, lint dell'upstream, `rust-version = "1.89"`, `log` e `proptest` senza `workspace = true` |
| `assets/hyphenation/` | `assets/hyphenation/` | nessuna |
| `assets/spelling/` | `assets/spelling/` | nessuna |
| `rustfmt.toml` | `rustfmt.toml` | nessuna |

Le modifiche al sorgente servono soltanto a passare
`cargo clippy --workspace --all-targets -- -D warnings` della CI di Fub, dove
`-D warnings` sulla riga di comando vince sui `[lints]` del manifest:

- `src/lib.rs`: il `#![deny(clippy::unwrap_used, …)]` dell'upstream diventa
  `#![cfg_attr(not(test), deny(…))]`. Il codice di libreria resta vietato come
  nell'upstream; i test dell'upstream usano `unwrap()` e senza la condizione non
  compilano sotto `--all-targets`;
- `src/ru/mod.rs`: nel ramo `[prefix, rest]` di una parola col trattino, la
  variabile mai letta `rest` diventa `_`. Il comportamento non cambia.

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

1. scegli un commit dell'upstream e confronta `crates/proof` e `assets/` con
   questa copia;
2. copia i file cambiati e riapplica le modifiche elencate qui sopra, se
   l'upstream non le contiene già;
3. riporta nel `Cargo.toml` qui le dipendenze nuove dell'upstream;
4. aggiorna commit e impronte in questa pagina;
5. esegui `cargo test -p wordcraft-proof` e i test di `fub-features` con la
   feature `proof`.

Una correzione che serve a Fub va proposta all'upstream; finché non entra, va
elencata nella tabella delle modifiche qui sopra.
