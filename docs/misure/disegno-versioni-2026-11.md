# 2026-11-02, le versioni in comune fra Fub e il motore del disegno

Questa pagina conserva il controllo di T5 del piano K5: se le librerie SVG di
Fub possono salire alle versioni che usa il motore del disegno (VectorCraft),
così che il motore non porti una seconda copia di ciascuna.

> **Per chi:** chi aggiunge il motore del disegno al workspace (T6, T9) e chi
> decide sulle dipendenze nuove (D-3 del piano K5).
> **Risultato:** sapere che `resvg`/`usvg` 0.48 non si possono prendere finché
> manca un convertitore SVG → PDF che le usi, e quali librerie resteranno
> doppie.

## Chi, cosa, quando

- commit `50e567aa` di Fub, ramo `coder/k5-t5`, 2026-11-02;
- macchina: server-di-fub, AMD Ryzen 7 7730U, Debian 13, kernel 6.12;
- Rust 1.95, `cargo tree --offline` sul `Cargo.lock` del commit;
- VectorCraft letto (senza compilarlo) alla revisione `cfb30d81`;
- le versioni pubblicate lette da crates.io il 2026-11-02 (`cargo search`,
  `cargo info` e l'API `https://crates.io/api/v1/crates/<nome>`).

## Le versioni

| Libreria | Fub (`Cargo.lock`) | VectorCraft `cfb30d81` |
|---|---|---|
| `usvg` | 0.45.1 (con `text`) | 0.48 (senza `text`, con `svgz`) |
| `resvg` | 0.45.1 | — |
| `svg2pdf` | 0.13.0 | — (il PDF lo scrive `krilla` 0.8) |
| `fontdb` | 0.23.0 | — (lo chiederebbe `usvg` 0.48 con `text`: 0.24) |
| `svgtypes` | 0.15.3 | 0.16 (tramite `usvg` 0.48) |
| `roxmltree` | 0.20.0 | 0.21 (tramite `usvg` 0.48) |
| `tiny-skia` | 0.11.4 | `tiny-skia-path` 0.12 (tramite `usvg` 0.48) |
| `imagesize` | 0.13.0 | 0.15 (tramite `usvg` 0.48) |
| `kurbo` | 0.11.3, 0.12.0, 0.13.1 | 0.13 |
| `skrifa` | 0.40.0, 0.42.1 | 0.47 |
| `peniko` | 0.5.0 | 0.6 |
| `image` | 0.25.10 | 0.25 |

## Il convertitore SVG → PDF

L'export PDF del disegno (`crates/fub-features/src/draw.rs`) passa da
`svg2pdf`, che lavora sull'albero di `usvg`: `resvg` e `svg2pdf` devono usare
la stessa `usvg`. Le versioni pubblicate al 2026-11-02:

| Crate | Ultima versione | Pubblicata | `usvg` richiesta |
|---|---|---|---|
| `svg2pdf` | 0.13.0 | 2025-03-04 | `^0.45` (anche `resvg ^0.45`) |
| `krilla-svg` | 0.8.1 | 2026-06-04 | `^0.47` (anche `resvg ^0.47`) |
| `usvg`, `resvg` | 0.49.0 | 2026-10-24 | — |

Nessun `svg2pdf` pubblicato usa `usvg` 0.48: l'ultimo, 0.13.0, chiede 0.45.
Nemmeno `krilla-svg`, che lo sostituisce nel progetto Typst, arriva a 0.48.
Il piano dice di fermarsi in questo caso (A15, D-3): **il `Cargo.lock` non
cambia** e Fub resta su `resvg`/`usvg` 0.45.1 e `svg2pdf` 0.13.0.

Le strade possibili, da decidere in D-3:

- aspettare un `svg2pdf` (o un `krilla-svg`) che usi `usvg` 0.48;
- tenere due `usvg`, 0.45 per l'export e 0.48 per il motore (vedi sotto);
- abbassare `usvg` del motore con una patch in `vendor/vectorcraft/patches/`.

## Le librerie doppie

Il conto è quello del piano:
`cargo tree -e normal --all-features --target all -d -p fub-app`. Un nome
compare due volte con la stessa versione quando `cargo tree` separa la build
dell'host e quella del bersaglio: quei nomi non sono contati.

| Momento | Nomi in più versioni | Versioni di quei nomi |
|---|---|---|
| prima di T5 (`50e567aa`) | 45 | 109 |
| dopo T5 | 45 | 109 |

Dopo T5 il conto è lo stesso perché il lock non è cambiato.
`cargo tree -p fub-app -e normal --all-features -i usvg` mostra una versione
sola, `usvg v0.45.1`.

### Quelle che resteranno doppie col motore

Con il motore nel workspace (T9), finché `usvg` resta a 0.45:

- `usvg` 0.45 e 0.48, e con loro `svgtypes` (0.15, 0.16), `roxmltree`
  (0.20, 0.21), `tiny-skia-path` (0.11, 0.12), `imagesize` (0.13, 0.15) e
  `kurbo` 0.11, che entra con `usvg` 0.45 e `svgtypes` 0.15;
- `kurbo` resta in più versioni anche con `usvg` allineata: la 0.12 viene da
  `hayro` e `peniko` 0.5 (il lettore PDF), la 0.13 da `fub-features`,
  `subsetter` e `write-fonts`, ed è quella del motore;
- `skrifa` passa a tre versioni: 0.40 da `hayro-interpret`, 0.42 da
  `fub-features` e `subsetter`, 0.47 dal motore; le versioni di Fub seguono
  `hayro` e `subsetter`, non `usvg`;
- `peniko` 0.5 (da `hayro`) e 0.6 (dal motore).

`image` resta una (0.25), come `fontdb` (0.23): il motore usa `usvg` senza
`text`, quindi non porta `fontdb` 0.24.

## I caratteri del sistema

`system-fonts` di `resvg` resta spento.
`cargo tree -p fub-features --features draw -e features` accende di `resvg`
soltanto `gif`, `image-webp`, `raster-images` e `text`. `fontdb` ha `fs` e
`fontconfig` perché li accende `svg2pdf` (lo spiega il commento in
`crates/fub-features/Cargo.toml`), come prima di T5.
