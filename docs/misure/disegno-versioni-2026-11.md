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

## Dopo T9: il motore nel workspace

T9 ha aggiunto `crates/fub-disegno`, l'adattatore, con `vectorcraft-engine`
senza le feature di serie, `vectorcraft-tools`, `-svg`, `-doc` e `-geom`.

- commit base `a9c1f3c5` di Fub, ramo `coder/k5-t9`, 2026-11-09;
- stessa macchina e stesso Rust; VectorCraft dalla copia in
  `vendor/vectorcraft/` (revisione `cfb30d81`).

`fub-app` non dipende ancora da `fub-disegno`: lo monterà `fub-host` (T13,
T19). Il conto «dopo» è quindi quello dell'albero di `fub-app` più
`fub-disegno`, con le feature unite come saranno allora:

```bash
cargo tree -p fub-app -p fub-disegno -e normal --prefix depth --all-features --target all > albero.txt
node .github/scripts/check-motori.mjs --albero albero.txt
```

| Albero | Nomi in più versioni |
|---|---|
| `fub-app`, l'albero che `check-motori.mjs` misura | 45 |
| `fub-app` più `fub-disegno` | 60 |

Il tetto `librerie_doppie` di `docs/reference/budgets.json` passa da 45 a 60,
una volta sola (D-3 (a)); finché `fub-host` non monta il motore la guardia
avvisa che può scendere a 45, e non va abbassato.

### Le librerie doppie nuove

Chi porta ogni versione:
`cargo tree -p fub-app -p fub-disegno -e normal --all-features --target all -i <crate>@<versione>`.

| Libreria | Versione di Fub, portata da | Versione del motore, portata da | Perché resta doppia |
|---|---|---|---|
| `usvg` | 0.45.1, `resvg` e `svg2pdf` (`fub-features`) | 0.48.1, `vectorcraft-svg` | nessun `svg2pdf` usa la 0.48 (sopra) |
| `svgtypes` | 0.15.3, `usvg` 0.45 e `resvg` | 0.16.2, `usvg` 0.48 e `vectorcraft-svg` | segue `usvg` |
| `roxmltree` | 0.20.0, `usvg` 0.45 e `fontconfig-parser` | 0.21.2, `usvg` 0.48 e `vectorcraft-engine` | segue `usvg` |
| `tiny-skia-path` | 0.11.4, `usvg` 0.45 e `tiny-skia` | 0.12.0, `usvg` 0.48 | segue `usvg` |
| `imagesize` | 0.13.0, `usvg` 0.45 e `fub-features` | 0.15.0, `usvg` 0.48 | segue `usvg` |
| `vello_cpu` | 0.0.5, `hayro` (il lettore PDF di `fub-features`) | 0.2.0, `vectorcraft-render` e `vectorcraft-text` | il disegnatore del motore; il `hayro` 0.5 di Fub usa la 0.0.5 |
| `vello_common` | 0.0.5, `vello_cpu` 0.0.5 | 0.2.0, `vello_cpu` 0.2 e `vectorcraft-render` | segue `vello_cpu` |
| `peniko` | 0.5.0, `vello_common` 0.0.5 | 0.6.1, `vello_common` 0.2 | segue `vello_cpu` |
| `fearless_simd` | 0.3.0, `vello_common` 0.0.5 e `hayro-jpeg2000` 0.2 | 0.4.1, `vello_common` 0.2 e `hayro-jpeg2000` 0.3 | segue `vello_cpu` e `hayro-jpeg2000` |
| `hayro-jpeg2000` | 0.2.0, `hayro-syntax` (`hayro`) | 0.3.5, `vectorcraft-engine` (la lettura dei JPEG 2000, `cmd/fileio/jp2read.rs`) | il motore la fissa a `=0.3.5`; il `hayro` 0.5 di Fub usa la 0.2 |
| `hayro-ccitt` | 0.2.0, `hayro-syntax` e `hayro-jbig2` | 0.3.0, `vectorcraft-doc` (i TIFF a un bit) | come `hayro-jpeg2000` |
| `font-types` | 0.11.3, `read-fonts` 0.37 e 0.39 | 0.12.7, `read-fonts` 0.43 e 0.44 | segue `skrifa` e `harfrust` del motore |
| `windows-registry` | 0.5.3, `tauri-plugin-deep-link` | 0.6.1, `vectorcraft-text` (solo Windows: i caratteri installati fuori dalle cartelle di sistema) | `tauri-plugin-deep-link` 2.4.10 usa la 0.5 |
| `windows-result` | 0.3.4, `windows-core` 0.61 e `windows-registry` 0.5 | 0.4.1, `windows-registry` 0.6 | segue `windows-registry` |
| `windows-strings` | 0.4.2, `windows-core` 0.61 e `windows-registry` 0.5 | 0.5.1, `windows-registry` 0.6 | segue `windows-registry` |

Due librerie già doppie prendono altre versioni, senza cambiare il conto dei
nomi: `read-fonts` (0.37 e 0.39 di Fub, più 0.43.3 da `harfrust` e 0.44.0 da
`skrifa` 0.47) e `skrifa` (0.40 e 0.42 di Fub, più 0.47.0 da
`vectorcraft-text`). `kurbo` non prende una versione in più: il motore usa la
0.13.1, che Fub ha già.

### Le versioni scelte nel lock

Il motore chiede `icu_segmenter` `2.3`. Lasciato libero, Cargo prende la 2.4,
che porta tutte le `icu_*` di Fub a 2.4 e con loro `yoke-derive` 0.8.4, che
aggiunge `synstructure` 0.14 accanto alla 0.13: una libreria doppia in più
nello stesso `fub-app`, senza il motore. Il lock tiene `icu_segmenter` 2.3.0
e le `icu_*` a 2.3, le versioni del `Cargo.lock` di `vendor/vectorcraft` con
cui i test del motore passano; `yoke-derive` resta a 0.8.2.

### Le feature spente

`cargo tree --workspace --all-features -e features -i vectorcraft-text` non
mostra `bundled-fonts`, e nell'albero normale del workspace non ci sono
`vectorcraft-pdf`, `-eps`, `-metafile`, `-affinity`, `-plugins`, `krilla`
né `wasmi`.

## Dopo T27: le versioni riallineate

T27 ha rifatto il conto con il motore dentro e ha allineato ciò che si poteva.

- commit base `724ad370` di Fub (ramo `piano/k5-disegno`, con `main` a
  `cedfa768` unito in `2031c92f`), 2026-11-12;
- macchina: pc-debian-di-fub, Intel 13600KF, Debian 13, kernel 6.12;
  Rust 1.95;
- le versioni pubblicate lette da crates.io il 2026-11-12 (l'API
  `https://crates.io/api/v1/crates/<nome>` e le dipendenze di ogni versione).

Gli alberi sono gli stessi di T9: quello di `fub-app`, che la guardia misura, e
quello di `fub-app` più `fub-disegno`, su cui è fissato il tetto.

| Momento | `fub-app` | `fub-app` più `fub-disegno` |
|---|---|---|
| dopo T9 (`a9c1f3c5`) | 45 | 60 |
| dopo l'unione con `main` (`724ad370`) | 46 | 61 |
| dopo T27 | 42 | 55 |

Il tetto `librerie_doppie` scende da 60 a 55. La guardia della CI misura il
solo `fub-app` e avvisa che potrebbe scendere a 42: non va abbassato sotto 55
finché `fub-host` non monta il motore (T13, T19).

### Che cosa si è mosso

- **Le `icu_*` di nuovo a 2.3.** L'unione con `main` aveva risolto il lock da
  capo: le `icu_*` erano salite a 2.4 e con loro `yoke-derive` 0.8.4, che
  porta `synstructure` 0.14 accanto alla 0.13 (la doppia in più di `fub-app`).
  Il lock torna alle versioni di T9 (`icu_segmenter` 2.3.0, `icu_provider`
  2.3.1, `yoke` 0.8.3, `yoke-derive` 0.8.2, `tinystr` 0.8.4, `zerovec`
  0.11.8; con loro `roxmltree` 0.21.2 e `svgtypes` 0.16.2, quelle del lock di
  `vendor/vectorcraft`). `rustix` resta alla 1.1.6 di `main`.
- **`hayro` da 0.5 a 0.6** in `fub-features` (il rasterizzatore delle pagine
  del PDF redatto e del PDF annotato). La 0.6 legge i JPEG 2000 e i fax con
  `hayro-jpeg2000` 0.3.5 e `hayro-ccitt` 0.3, le stesse del motore, e disegna
  con `vello_cpu` 0.0.7, che usa `peniko` 0.6 e `fearless_simd` 0.4 come il
  motore. Escono doppie quattro librerie (`hayro-jpeg2000`, `hayro-ccitt`,
  `peniko`, `fearless_simd`) e, nel solo `fub-app`, anche `kurbo` 0.12,
  `moxcms` 0.7, `skrifa` 0.40 e `read-fonts` 0.37. Il motivo per cui Fub era
  rimasto alla 0.5, un compilatore più nuovo, non vale più: il workspace è a
  Rust 1.95 e `vello_cpu` 0.0.7 chiede 1.92. L'API cambia di un argomento,
  la cache di `hayro::render`, creata per ogni pagina. Le feature restano
  quelle della 0.5: `embed-fonts` sì, `embed-cmaps` (di serie dalla 0.6) no.
- **`hayro-jbig2` tenuta a 0.3.0.** Lasciata libera, Cargo prende la 0.3.1,
  che chiede `hayro-ccitt` 0.4 e `fearless_simd` 1.2 e rifà doppie le due
  librerie appena allineate. `hayro-syntax` 0.6 accetta la 0.3.0.

Le versioni più nuove di `hayro` non servono: la 0.7 usa `vello_cpu` 0.0.8
e non toglie altre doppie; dalla 0.8 `vello_cpu` sale a 0.3 e
`hayro-jpeg2000` a 0.4, che non sono quelle del motore.

Entrano nel lock tre crate, tutti `Apache-2.0 OR MIT`: `hayro-cmap`,
`hayro-postscript` e `vello_api`; ne escono `hayro-font`, `fast_image_resize`
5 (resta la 6) e le versioni vecchie dette sopra. `cargo deny check` è verde,
senza avvisi nuovi e senza licenze nuove.

**L'export non cambia.** Il PDF redatto della prova
`the_redacted_pdf_has_no_trace_of_what_is_covered` (una pagina disegnata da
`hayro` a 200 punti per pollice) esce uguale byte per byte con la 0.5 e con
la 0.6 (sha256 `0dac8294…`), e i test di `fub-features --features draw`
passano tutti, compresi quelli che leggono i pixel di una pagina stampata.

### Che cosa si è provato e non si muove

- **`svg2pdf`** (per `usvg`, `svgtypes`, `roxmltree`, `tiny-skia-path`,
  `imagesize`, `kurbo` 0.11): l'ultimo è ancora 0.13.0 del 2025-03-04, con
  `usvg` 0.45; `krilla-svg` 0.8.1 chiede `usvg` 0.47. `resvg` 0.50 è uscita
  il 2026-11-11, ma senza un convertitore che la segua non serve.
- **Tauri 2.12** (per `windows-registry`, `windows-result`,
  `windows-strings`, `windows-link`): `tauri-plugin-deep-link` usa
  `windows-registry` 0.6 dalla 2.6.0, che chiede `tauri` 2.12.
  `cargo update -p tauri-plugin-deep-link --precise 2.6.3` toglie le quattro
  doppie `windows-*` ma ne porta diciassette nuove (`html5ever`,
  `markup5ever`, `selectors`, `cssparser`, `phf` con i suoi tre crate,
  `brotli-decompressor` e altre): il conto sale a 68. In più `tauri` deve
  salire insieme a `@tauri-apps/api` nel lock di npm. Resta un lavoro a sé.
- **`cargo update` di tutto il lock**: il conto sale a 73.
- **`skrifa`** di `fub-features` a 0.47: la doppia resta, perché `subsetter`
  0.2.6 (l'ultima, sotto `svg2pdf`) chiede la 0.42, e `fub-features` usa
  apposta le stesse versioni di `subsetter` per istanziare i caratteri.
- **`tantivy`** (per `nom` 7): una versione nuova cambia il formato
  dell'indice su disco; fuori da questo task.

### Le librerie ancora doppie

Il conto di `cargo tree -p fub-app -p fub-disegno -e normal --all-features
--target all`, 55 nomi; chi porta ogni versione è il genitore diretto
(`cargo tree … -i <crate>@<versione> --depth 1`). Le prime 13 entrano con il
motore, le altre 42 c'erano già in `fub-app`.

| Libreria | Versioni, portate da | Perché resta |
|---|---|---|
| `usvg` | 0.45.1: `resvg`, `svg2pdf`; 0.48.1: `vectorcraft-svg` | nessun `svg2pdf` usa la 0.48 |
| `svgtypes` | 0.15.3: `usvg` 0.45, `resvg`; 0.16.2: `usvg` 0.48, `vectorcraft-svg` | segue `usvg` |
| `roxmltree` | 0.20.0: `usvg` 0.45, `fontconfig-parser`; 0.21.2: `usvg` 0.48, `vectorcraft-engine` | segue `usvg` |
| `tiny-skia-path` | 0.11.4: `usvg` 0.45, `tiny-skia`; 0.12.0: `usvg` 0.48 | segue `usvg` |
| `imagesize` | 0.13.0: `usvg` 0.45, `fub-features`; 0.15.0: `usvg` 0.48 | segue `usvg`; `fub-features` misura le immagini come `usvg` 0.45 |
| `vello_cpu` | 0.0.7: `hayro`; 0.2.0: `vectorcraft-render`, `vectorcraft-text` | nessun `hayro` usa la 0.2 (la 0.7 ha la 0.0.8, dalla 0.8 la 0.3) |
| `vello_common` | 0.0.7: `vello_cpu` 0.0.7; 0.2.0: `vello_cpu` 0.2, `vectorcraft-render` | segue `vello_cpu` |
| `skrifa` | 0.42.1: `fub-features`, `hayro-interpret`, `subsetter`; 0.47.0: `vectorcraft-text` | `subsetter` 0.2.6 chiede la 0.42 |
| `read-fonts` | 0.39.2: `skrifa` 0.42, `write-fonts`; 0.43.3: `harfrust`; 0.44.0: `skrifa` 0.47 | segue `skrifa` e `harfrust` del motore |
| `font-types` | 0.11.3: `read-fonts` 0.39, `write-fonts`; 0.12.7: `read-fonts` 0.43 e 0.44 | segue `read-fonts` |
| `windows-registry` | 0.5.3: `tauri-plugin-deep-link` 2.4; 0.6.1: `vectorcraft-text` | la 0.6 chiede Tauri 2.12 (sopra) |
| `windows-result` | 0.3.4: `windows-core` 0.61, `windows-registry` 0.5, `tauri-plugin-deep-link`; 0.4.1: `windows-registry` 0.6 | segue `windows-registry` |
| `windows-strings` | 0.4.2: `windows-core` 0.61, `windows-registry` 0.5; 0.5.1: `windows-registry` 0.6 | segue `windows-registry` |
| `base64` | 0.21.7: `swift-rs` (Tauri su macOS); 0.22.1: crate di Fub, `reqwest`, `wry`, `usvg` e altri | `swift-rs` 1.0.7, sotto Tauri 2.11 |
| `bitflags` | 1.3.2: `webkit2gtk`, `javascriptcore-rs`, `png` 0.17; 2.13.1: quasi tutti | le librerie GTK 0.18 di Tauri 2.11 |
| `block-buffer` | 0.10.4: `digest` 0.10; 0.12.1: `digest` 0.11 | segue `sha2` 0.10 |
| `cfb` | 0.7.3: `infer` (Tauri); 0.15.0: `wordcraft-*`, `vectorcraft-engine` | `infer` 0.19 di `tauri-utils` 2.9 |
| `cpufeatures` | 0.2.17: `sha2` 0.10; 0.3.1: `sha2` 0.11, `sha1`, `aes`, `chacha20` | segue `sha2` 0.10 |
| `crypto-common` | 0.1.7: `digest` 0.10; 0.2.2: `digest` 0.11, `cipher` | segue `sha2` 0.10 |
| `digest` | 0.10.7: `sha2` 0.10; 0.11.3: `sha2` 0.11, `hmac`, `md-5`, `sha1` | segue `sha2` 0.10 |
| `sha2` | 0.10.9: `tauri-codegen`, `wry`; 0.11.0: crate di Fub, `lopdf`, `gridcraft-*`, `wordcraft-docx` | Tauri 2.11 e `wry` 0.55 usano la 0.10 |
| `foldhash` | 0.1.5: `hashbrown` 0.15; 0.2.0: `hashbrown` 0.16 e 0.17, `dom_query` | segue `hashbrown` |
| `hashbrown` | 0.12.3: `indexmap` 1; 0.14.5: `ordered-multimap`; 0.15.5: `wasmtime`, `cranelift-codegen`, `object`, `regalloc2`; 0.16.1: `lru`, `vello_cpu` 0.0.7; 0.17.1: `indexmap` 2, `vello_cpu` 0.2 | ogni crate di terzi la sua; `wasmtime` resta alla 36 |
| `indexmap` | 1.9.3: `schemars` 0.8 (Tauri); 2.14.0: quasi tutti | `schemars` 0.8 di `tauri-utils` |
| `getrandom` | 0.2.17: `ring`, `redox_users`, `const-random-macro`; 0.3.4: `tauri`, `wordcraft-docx`; 0.4.3: `lopdf`, `rand`, `tempfile`, `uuid` | tre generazioni di crate di terzi |
| `r-efi` | 5.3.0: `getrandom` 0.3; 6.0.0: `getrandom` 0.4 | segue `getrandom` |
| `gif` | 0.13.3: `resvg` 0.45; 0.14.2: `image`, `vectorcraft-render` | segue `resvg` (e `svg2pdf`) |
| `zune-jpeg` | 0.4.21: `resvg` 0.45; 0.5.15: `image`, `hayro-syntax`, `tiff`, `vectorcraft-doc` | segue `resvg` |
| `zune-core` | 0.4.12: `zune-jpeg` 0.4; 0.5.3: `zune-jpeg` 0.5, `image` | segue `zune-jpeg` |
| `png` | 0.17.16: `tiny-skia` 0.11, `ico`, `tauri-codegen`; 0.18.1: `fub-features`, `image`, `muda`, `vello_*`, `vectorcraft-render` | `tiny-skia` 0.11 di `resvg` 0.45, e Tauri 2.11 |
| `kurbo` | 0.11.3: `usvg` 0.45, `svgtypes` 0.15; 0.13.1: `fub-features`, `hayro`, `subsetter`, il motore | segue `usvg` |
| `weezl` | 0.1.12: `gif`, `tiff`; 0.2.1: `lopdf`, `vectorcraft-render` | nessun `gif` o `tiff` pubblicato usa la 0.2 |
| `heck` | 0.4.1: `glib-macros` 0.18; 0.5.0: `tauri`, `clap_derive`, `wasmtime` | le librerie GTK 0.18 di Tauri |
| `proc-macro-crate` | 1.3.1: `gtk3-macros`; 2.0.2: `glib-macros`; 3.5.0: `zbus_macros`, `num_enum_derive`, `zvariant_derive` | le librerie GTK 0.18 di Tauri |
| `toml_edit` | 0.19.15 e 0.20.2: `proc-macro-crate` 1 e 2; 0.25.13: `proc-macro-crate` 3 | segue `proc-macro-crate` |
| `toml_datetime` | 0.6.3: `toml_edit` 0.19 e 0.20; 1.1.1: `toml_edit` 0.25, `toml` | segue `toml_edit` |
| `serde_spanned` | 0.6.9: `toml_edit` 0.20; 1.1.1: `toml` | segue `toml_edit` |
| `winnow` | 0.5.40: `toml_edit` 0.19 e 0.20; 1.0.4: `toml_edit` 0.25, `toml`, `zbus` | segue `toml_edit` |
| `syn` | 1.0.109: `proc-macro-error`; 2.0.119 e 3.0.3: le macro dei crate di terzi | ogni macro la sua |
| `thiserror` | 1.0.69: `glib`, `gio`, `cairo-rs`, `jni`, `ndk`, `json-patch`; 2.0.19: crate di Fub e quasi tutti | le librerie GTK 0.18 e Android di Tauri |
| `thiserror-impl` | 1.0.69 e 2.0.19: `thiserror` | segue `thiserror` |
| `io-lifetimes` | 2.0.4: `fs-set-times`; 3.0.1: `cap-std`, `cap-primitives`, `io-extras` | il WASI di `wasmtime` 36 |
| `jni-sys` | 0.3.1: `jni` 0.21, `ndk`; 0.4.1: `jni-sys` 0.3 | Tauri su Android; la 0.3.1 rimanda alla 0.4 |
| `nom` | 7.1.3: `tantivy-query-grammar`; 8.0.0: `lopdf` | un `tantivy` nuovo cambia l'indice su disco |
| `windows-link` | 0.1.3: `windows-core` 0.61 e la sua famiglia; 0.2.1: `windows-sys` 0.61 e altri | Tauri 2.11 usa `windows` 0.61 |
| `windows-sys` | 0.45.0: `jni`; 0.52.0: `ring`; 0.59.0: `fs4`, `fs-set-times`, `winx`, `window-vibrancy`; 0.60.2: `notify`, `rfd`, `wasmtime` e altri; 0.61.2: crate di Fub e quasi tutti | ogni crate di terzi la sua |
| `windows-targets` | 0.42.2, 0.52.6, 0.53.5: `windows-sys` 0.45, 0.52 e 0.59, 0.60 | segue `windows-sys` |
| `windows_aarch64_gnullvm` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_aarch64_msvc` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_i686_gnu` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_i686_gnullvm` | 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_i686_msvc` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_x86_64_gnu` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_x86_64_gnullvm` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |
| `windows_x86_64_msvc` | 0.42.2, 0.52.6, 0.53.1: `windows-targets` | segue `windows-targets` |

### Solo nei test

`-e normal` non conta le dipendenze dei test. Con `-e normal,dev` su tutto il
workspace si aggiunge una sola doppia: `wit-parser` 0.236.1 (da `wasmtime` 36)
e 0.254.0 (dev-dependency di `fub-abi`, che controlla i WIT). Non dipende dal
motore e non entra in ciò che si installa.
