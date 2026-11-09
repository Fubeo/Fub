# VectorCraft vendorizzato

Questa cartella contiene il motore di
[VectorCraft](https://github.com/storytold/vectorcraft), copiato con le due
patch elencate qui sotto. Fub non dipende da VectorCraft via Git: `deny.toml`
ammette soltanto crates.io, e i crate non sono pubblicati là.

Il fork [`Fubeo/vectorcraft`](https://github.com/Fubeo/vectorcraft) è il
mirror: il campo `mirror` di `upstream.lock` lo nomina, `update` senza lock
parte da lì e `verify-upstream` lo prova dopo l'upstream.

Venti crate: la geometria, il colore e il modello del documento (`geom`,
`color`, `doc`), le operazioni sui tracciati, i pennelli e la vettorizzazione
(`pathops`, `brush`, `trace`), il testo (`text`), gli effetti (`effects`) con
l'host dei plug-in WebAssembly (`plugins`), il 3D (`three-d`), il
renderizzatore (`render`), l'SVG e il formato nativo (`svg`, `format`), i
lettori di DXF, EMF/WMF e Affinity (`cad`, `metafile`, `affinity`), il
controllo degli script (`scriptcheck`), gli strumenti (`tools`), la facciata
con la sessione e i comandi (`engine`) e gli aiuti dei test (`testkit`). Non
sono copiati: l'interfaccia (`ui-egui`), il server MCP (`mcp`), le app
(`apps/*`), `xtask`, il PDF (`crates/pdf`) e l'EPS (`crates/eps`).

## Riferimento

- repository: `https://github.com/storytold/vectorcraft`
- commit: `cfb30d8139161cf1722dfabf3046741a0b21b3da` (2026-11-02, versione
  `0.20.0`)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Patch che lo toccano |
|---|---|---|
| `crates/geom/`, `color/`, `doc/`, `pathops/`, `brush/`, `trace/`, `text/`, `plugins/`, `three-d/`, `svg/`, `format/`, `cad/`, `metafile/`, `affinity/`, `scriptcheck/`, `tools/`, `testkit/` | gli stessi | nessuna |
| `crates/effects/` | `crates/effects/` | `0001` (`Cargo.toml`, `src/catalog.rs`, `src/geometry.rs`, `src/params.rs`) |
| `crates/render/` | `crates/render/` | `0001` (`Cargo.toml`, una dipendenza dei test) |
| `crates/engine/` | `crates/engine/` | `0001` (22 file: `Cargo.toml`, 12 di `src/`, 9 di test); `0002` (85 file: `Cargo.toml`, 23 di `src/`, 61 di test) |
| `xtask/src/sha256.rs`, `xtask/affinity-corpus.sha256` | gli stessi | nessuna |
| `assets/fonts/` | `assets/fonts/` | nessuna |
| `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, `ASSETS.md` | gli stessi | nessuna |
| `rustfmt.toml` | lo stesso | nessuna |

Di `xtask` ci sono soltanto i due file che i test di `affinity` ed `engine`
includono con `#[path]` (la SHA-256 con cui il test del corpus Affinity
controlla i file, e il loro elenco): `xtask` non si copia e non gira.
`rustfmt.toml` è lo stile dell'upstream: `cargo fmt --all` di Fub segue le
dipendenze a percorso e controlla anche questi crate, con il `rustfmt.toml`
più vicino. Le righe delle patch sono formattate con lo stesso stile.
L'elenco esatto dei file di ogni patch è nelle sue intestazioni `diff --git`,
e `vendor.mjs vectorcraft report` lo incrocia con ciò che l'upstream cambia.

I manifest dei crate sono quelli dell'upstream (più le patch). Ereditano
versione, edizione, licenza, lint e dipendenze da `Cargo.toml` di questa
cartella, che è di Fub e non dell'upstream: un workspace con i venti crate,
fuori da quello di Fub (`exclude` nel `Cargo.toml` radice), con il suo
`Cargo.lock`. Le due librerie di craft-libs che il motore usa,
`craft-docpath` e `craft-vectorcraft-format`, non sono su crates.io: stanno
in `vendor/craft-docpath/` e `vendor/craft-vectorcraft-format/`, ognuna alla
sua revisione, e questo `Cargo.toml` le prende per percorso. Rispetto al
workspace dell'upstream, `flate2` (1.1.9), `image` (0.25.10) e `rustix` (1)
chiedono le versioni del `Cargo.toml` di Fub; il `Cargo.lock` risolve le
stesse versioni dell'upstream. Nessuna `[patch.crates-io]`: quelle
dell'upstream (`krilla`, i `hayro-*` di craft-libs) servono soltanto al PDF,
che qui non c'è.

I test dell'upstream girano qui, anche in CI, con `CRAFT_FONTS_DIR` vuoto
(`crates/text/build.rs` non scarica niente: senza la cartella di
craft-fonts `CRAFT_FONTS` è vuoto):

```text
CARGO_TARGET_DIR=target/vectorcraft cargo test --manifest-path vendor/vectorcraft/Cargo.toml --workspace --locked --no-fail-fast
```

Fuori dal workspace di Fub, i crate non passano dal suo
`cargo clippy --workspace --all-targets -- -D warnings`: i lint del
workspace qui sono `warnings = "allow"` e `clippy::all = "allow"`, con
`unsafe_code = "deny"` come nell'upstream. Gli avvisi li corregge
l'upstream, non una copia.

### Le patch

Le due patch spengono parti del motore che il disegno di Fub non usa, perché
non entrino nella build né nel lock. Entrambe sono **UPSTREAM-API**: una
feature in più, che l'upstream terrebbe accesa di serie.

| Patch | Tipo | File | Cosa fa | Upstream | Quando cade |
|---|---|---|---|---|---|
| `0001-importatori-opzionali` | UPSTREAM-API | 27 (`effects` 4, `engine` 22, `render` 1), +170 −13 | in `engine` le feature `metafile` (EMF, WMF), `affinity` (Affinity Designer) e `plugins` (i plug-in WebAssembly, con `effects/plugins`), spente; i crate diventano dipendenze opzionali, il codice che li chiama sta dietro `#[cfg]` | da proporre a monte: gli importatori e i plug-in dietro feature | quando l'upstream ha feature equivalenti |
| `0002-pdf-opzionale` | UPSTREAM-API | 85, tutti in `engine`, +540 −17 | toglie `vectorcraft-pdf` e `vectorcraft-eps` dalle dipendenze di `engine`; il codice del PDF, dell'EPS e dell'Illustrator (`.ai`), con i comandi che li leggono e li scrivono (`document.exportPdf`, la stampa, i predefiniti PDF e di stampa, `clipboard.importPdf`, …), sta dietro `#[cfg(feature = "pdf")]` | da proporre a monte: il PDF dietro una feature (`pdf = ["dep:vectorcraft-pdf", "dep:vectorcraft-eps"]`, accesa di serie) | quando l'upstream ha la feature |

La feature `pdf` non è dichiarata nel `Cargo.toml` di `engine`: dichiararla
vorrebbe le dipendenze `vectorcraft-pdf` ed `vectorcraft-eps`, che il lock
risolverebbe anche spente, e con loro `craft-pdf`, `krilla` e i `hayro-*` da
Git. Così il codice dietro `cfg(feature = "pdf")` non si compila mai qui;
l'avviso `unexpected_cfgs` che ne viene è spento dai lint del workspace.
Proposta a monte, la patch dichiara la feature.

`cad` e `scriptcheck` restano obbligatori, diversamente da quanto il piano
pensava: `LoadOptions` (pubblico) porta le opzioni d'importazione del DXF di
`vectorcraft-cad`, e `scriptcheck` serve ai comandi degli script, non a un
importatore.

Senza i lettori e gli scrittori spenti, il motore si comporta così:

- `document.formats` non elenca i formati spenti; `document.open` e
  `file.place` di un file EMF, WMF o Affinity rispondono «not a format
  VectorCraft reads»;
- PDF, Illustrator ed EPS stanno tra gli `unsupported` di `document.formats`
  (dopo DWG, PICT e PageMaker), con il suggerimento «… files are not
  available in this build: export SVG or PNG instead», che è anche la
  risposta di `document.open` per un file di quei formati;
- `document.saveAs` e `saveCopy` verso un percorso `.pdf`, `.ai`, `.ait`,
  `.eps`, `.epsf` o `.ps` senza `format`, ed `export` o `saveCopy` con
  `format` `pdf`, `ai` o `eps`, sono rifiutati con quel suggerimento e non
  scrivono niente: senza la patch il
  motore avrebbe scritto il formato nativo sotto quel nome. Lo stesso vale
  per un percorso `.dwg`, che già prima non si poteva scrivere. Lo prova
  `tests/save.rs`: `without_the_pdf_writer_its_files_are_refused_by_name`;
- `file.place` prende come riquadro soltanto `crop` (la tavola) e
  `bounding` (i contorni): gli altri (art, trim, bleed, media) sono delle
  pagine PDF.

### I test spenti

I test che leggono o scrivono un formato spento stanno dietro la sua
feature, non sono tolti: con le feature accese tornano. Non c'è un test che
fallisce.

| Feature | Test spenti | Moduli o file di test spenti interi |
|---|---|---|
| `pdf` | 229 | 25 moduli (14 di `cmd/fileio`, 11 di `tests`: la stampa, i predefiniti PDF, il PDF/X, l'importazione PDF, EPS e Illustrator, …) |
| `affinity` | 3 | 5 moduli (`tests_affinity` e quattro di `tests/it`) e 3 file (`affinity_artboards`, `affinity_corpus`, `affinity_text`) |
| `metafile` | 3 | 1 modulo (`tests_metafile`) |
| `plugins` | 1 | 1 modulo (`tests::plugins`) e 2 file (`plugin_export`, `plugin_fuzz`) |

Alcuni dei test spenti per il PDF provano anche altro, insieme a un giro
in PDF (un salvataggio «in ogni formato», le unità e le guide che
sopravvivono al salvataggio, il PDF come uno dei formati di un'esportazione
in serie): quella parte non gira più qui. Con `--features
metafile,affinity,plugins` i test di `engine` ed `effects` passano tutti.

### Peso e tempo di compilazione

Misurati sulla copia di questo commit (2026-11-09, 16 thread, Rust 1.95,
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`):

- sorgenti: 27 MB in 1.268 file, di cui 23 MB nei crate (485.000 righe di
  Rust, 206.000 nei test; `engine` da solo 11 MB) e 3,3 MB di caratteri in
  `assets/fonts/`; le patch 174 kB; `upstream.lock` 184 kB;
- compilazione da zero dei test del workspace (`cargo test --workspace
  --locked --no-run` in una cartella `target` vuota): 407 s (6 min 47 s);
  la sola libreria di `vectorcraft-engine`, ricompilata dopo senza i test,
  125 s;
- esecuzione dei test, dopo la compilazione: 166 s, con 7.722 test che
  passano, nessuno che fallisce e 13 che l'upstream marca `#[ignore]`;
- `target/` della compilazione dei test: 2,8 GB.

## Dati inclusi e licenze

- I caratteri di `assets/fonts/`: Inter, JetBrains Mono, Source Sans 3 e
  Source Serif 4, sotto la SIL Open Font License 1.1, ognuno con il suo
  `OFL-*.txt` accanto. `crates/text` li incorpora; li elencano `NOTICE` e
  `ASSETS.md`.
- `ASSETS.md` e `NOTICE` sono quelli dell'upstream, interi: nominano anche
  file non copiati (le icone, i marchi di `docs/brand/`, che non sono open
  source e restano fuori).
- I caratteri giapponesi di craft-fonts non entrano: `CRAFT_FONTS_DIR` è
  vuoto.
- Le dipendenze da crates.io: `cargo deny check` sul workspace di questa
  cartella con il `deny.toml` di Fub
  (`cargo deny --manifest-path vendor/vectorcraft/Cargo.toml --config deny.toml check`)
  trova avvisi, divieti e sorgenti in regola, e una sola licenza fuori
  dall'elenco: `jpeg-encoder` 0.6 (`(MIT OR Apache-2.0) AND IJG`), che
  `render` usa per l'esportazione JPEG e `doc` nei test. `deny.toml` non
  ammette IJG; il `cargo deny check` di Fub resta verde finché nessun suo
  crate dipende dal motore.

## Aggiornare

La copia è derivata: l'upstream al commit di `upstream.lock` più le patch di
`patches/`, in ordine. Nessun file si modifica a mano.

```text
node tools/vendor-craft/vendor.mjs vectorcraft update --rev <sha> [--tag <tag>] [--source <clone o URL>]
node tools/vendor-craft/vendor.mjs vectorcraft check
node tools/vendor-craft/vendor.mjs vectorcraft verify-upstream
node tools/vendor-craft/vendor.mjs vectorcraft report --rev <sha> [--source <clone o URL>]
node tools/vendor-craft/vendor.mjs vectorcraft gate
```

`update`, `check`, `verify-upstream`, `report` e `gate` fanno ciò che fanno
per GridCraft ([`vendor/gridcraft/UPSTREAM.md`](../gridcraft/UPSTREAM.md)).
Dopo un `update`, il `Cargo.lock` di questa cartella si aggiorna con
`cargo update --manifest-path vendor/vectorcraft/Cargo.toml --workspace`, e
una patch che non si applica più si rifà a tre vie. Un test nuovo
dell'upstream che legge o scrive un formato spento va dietro la sua feature
nella patch che la introduce. Le due librerie di craft-libs si aggiornano
ognuna con la sua voce (`craft-docpath`, `craft-vectorcraft-format`).

Il perché di questa forma è nell'[ADR 0213](../../docs/decisions/0213-provenienza-dei-motori-esterni.md);
il ruolo di VectorCraft in Fub nell'[ADR 0239](../../docs/decisions/0239-il-disegno-sul-motore-vettoriale.md).
