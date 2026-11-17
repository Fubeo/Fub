# craft-vectorcraft-format vendorizzato

Questa cartella contiene il crate `craft-vectorcraft-format` di
[craft-libs](https://github.com/storytold/craft-libs), copiato senza
modifiche. È la busta del file `.vectorcraft` (i membri, la versione, le
immagini incorporate e i dati dopo il JSON, con il documento come parametro
di tipo), e lo usa soltanto VectorCraft (`vendor/vectorcraft/`, il crate
`vectorcraft-format`). Il crate non è pubblicato su crates.io, e `deny.toml`
ammette soltanto crates.io: per questo è copiato qui e non preso via Git.

Il fork [`Fubeo/craft-libs`](https://github.com/Fubeo/craft-libs) è il mirror:
il campo `mirror` di `upstream.lock` lo nomina, `update` senza lock parte da
lì e `verify-upstream` lo prova dopo l'upstream.

## Riferimento

- repository: `https://github.com/storytold/craft-libs`
- commit: `14d5dbb50c317b8747a9cf9eb35ab8a22515f137` (2026-11-01)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Patch che lo toccano |
|---|---|---|
| `crates/vectorcraft-format/` | `crates/vectorcraft-format/` | nessuna |
| `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` | gli stessi | nessuna |
| `rustfmt.toml` | lo stesso (lo stile dell'upstream, per `cargo fmt --all` di Fub) | nessuna |

Nessuna patch. Il manifest del crate è quello dell'upstream ed eredita
versione, edizione, licenza, lint e le dipendenze `serde`, `serde_json` e
`thiserror` da `Cargo.toml` di questa cartella, che è di Fub e non
dell'upstream: un workspace con il solo crate, fuori da quello di Fub
(`exclude` nel `Cargo.toml` radice), con le stesse versioni del workspace di
craft-libs. `flate2` il crate lo dichiara da sé. `vendor/vectorcraft/Cargo.toml`
lo prende per percorso e lo compila con il motore; i suoi test non girano in
CI, e il controllo della copia è:

```text
node tools/vendor-craft/vendor.mjs craft-vectorcraft-format check
```

## Aggiornare

```text
node tools/vendor-craft/vendor.mjs craft-vectorcraft-format update --rev <sha>
node tools/vendor-craft/vendor.mjs craft-vectorcraft-format check
```

Poi `vendor/vectorcraft/` ricompila e i suoi test passano
(`cargo test --manifest-path vendor/vectorcraft/Cargo.toml --workspace --locked`).
