# WordCraft vendorizzato

Questa cartella contiene codice e dati di
[WordCraft](https://github.com/storytold/wordcraft), copiati con le poche
modifiche elencate qui sotto. Fub non dipende da WordCraft via Git:
`deny.toml` ammette soltanto crates.io, e i crate non sono pubblicati là.

Sei crate: il correttore (`proof`) e, per i documenti di videoscrittura, il
modello del documento (`doc`), le sue unità di misura (`geom`), il codec DOCX
(`docx`), il lettore di Word 97-2003 (`docbin`) e gli import ed export degli
altri formati di testo (`formats`: OpenDocument, RTF e gli altri).

## Riferimento

- repository: `https://github.com/storytold/wordcraft`
- commit: `2e6db0bd88795e80375176c01665cff7dbe2b057` (tag `v0.9.0`, 2026-10-19)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Modifiche |
|---|---|---|
| `crates/proof/` | `crates/proof/` | nessuna |
| `crates/geom/` | `crates/geom/` | nessuna |
| `crates/doc/` | `crates/doc/` | nessuna |
| `crates/docx/` | `crates/docx/` | `src/package.rs` e sette file di `tests/` per `zip` 9; `src/write/settings_merge.rs`, `src/write/mod.rs` e `src/lib.rs` per una verifica in più |
| `crates/docbin/` | `crates/docbin/` | nessuna |
| `crates/formats/` | `crates/formats/` | un test di `src/odt.rs` per `zip` 9 |
| `assets/hyphenation/` | `assets/hyphenation/` | nessuna |
| `assets/spelling/` | `assets/spelling/` | nessuna |
| `rustfmt.toml` | `rustfmt.toml` | nessuna |
| `NOTICE` | `NOTICE` | elenca soltanto il materiale di terzi che questa copia porta |

I manifest dei crate sono quelli dell'upstream. Ereditano versione, edizione,
licenza, lint e dipendenze da `Cargo.toml` di questa cartella, che è di Fub e
non dell'upstream: un workspace con i sei crate, fuori da quello di Fub
(`exclude` nel `Cargo.toml` radice), con il suo `Cargo.lock`. Fub prende i sei
crate come dipendenze a percorso, con il proprio lock; i test dell'upstream
girano qui, anche in CI:

```text
cargo test --manifest-path vendor/wordcraft/Cargo.toml --workspace --locked
```

Fuori dal workspace di Fub, i crate non passano dal suo
`cargo clippy --workspace --all-targets -- -D warnings`: i lint del workspace
di questa cartella permettono gli avvisi, che corregge l'upstream e non una
copia, e vietano soltanto `unsafe`. Con la 1.95 di Fub i crate compilano e i
loro test passano.

Le patch di `patches/`, una per ragione:

- `0001-notice-del-materiale-copiato`: il `NOTICE` elenca soltanto il
  materiale di terzi che questa copia porta;
- `0002-zip-9`: l'upstream usa `zip` 3, che ha tre avvisi di sicurezza
  (RUSTSEC-2026-0367, -0368, -0369) corretti in `zip` 9. In `zip` 9 il nome di
  una voce dell'archivio è un `Result`: in `docx/src/package.rs` una voce dal
  nome illeggibile si salta con un avviso nel log, come l'upstream fa già con
  una voce illeggibile, e nei sette file di `docx/tests/` che leggono l'archivio
  `f.name()` diventa `f.name().unwrap()`. In `formats/src/odt.rs`, test
  `pictures_over_the_budget_are_not_inflated`, una voce che si espande oltre la
  misura dichiarata si ferma a quella misura e fallisce il controllo, quindi è
  rifiutata senza consumare il budget invece di esaurirlo: il test verifica
  ancora che sia rifiutata e che nessuna voce superi il budget, non più che il
  budget si esaurisca;
- `0003-settings-kept-unowned`: la funzione nuova `kept_unowned` di
  `docx/src/write/settings_merge.rs`, con il suo test, dice se una parte
  `settings.xml` scritta conserva, byte per byte, ogni figlio di `w:settings`
  che il modello non tiene e che `merge` dichiara di conservare; un
  `<w:compat/>` che `merge` espande per scriverci la modalità di
  compatibilità conta come conservato. La esportano
  `src/write/mod.rs` e `src/lib.rs` come `settings_kept_unowned`, insieme alla
  chiave `SETTINGS_ORIG` della copia originale. Serve a `fub-format-rich`, che
  rifiuta di scrivere un documento che perderebbe impostazioni in silenzio; il
  resto del codec non cambia. Va proposta all'upstream.

Le dipendenze del workspace di questa cartella hanno, per quelle in comune con
Fub, la stessa versione del `[workspace.dependencies]` di Fub, perché il grafo
dei due workspace sia lo stesso (lo controlla `vendor.mjs check`). Rispetto
all'upstream:

- `zip` passa da 3 a 9.0.5, per gli avvisi qui sopra;
- `serde_json` non accende `float_roundtrip`: le feature si unificano in tutto
  il grafo di Fub, e la libreria lo usa solo per leggere un colore, senza
  numeri in virgola mobile;
- `image` accende soltanto `png` e `bmp`, i due decodificatori senza
  dipendenze in più. L'upstream accende anche `jpeg`, `webp`, `gif` e `tiff`:
  senza, un'immagine di quei formati si legge lo stesso, ma senza la misura in
  pixel, e l'export RTF di WordCraft non la ricodifica in PNG. Un oggetto
  prende in Fub la misura che il documento gli dà; una copia RTF esportata
  porta un'immagine di quei formati senza la misura in pixel.

Le dipendenze che i manifest dichiarano soltanto per `wasm32` (`js-sys` di
`formats`, la feature `wasm_js` di `getrandom` in `docx`) restano: compaiono
negli archi del `Cargo.lock` di Fub, ma il desktop non le compila.

`formats` porta una sola dipendenza nuova per Fub, `chardetng` (rilevamento
della codifica di un testo, `MIT OR Apache-2.0`, dello stesso autore di
`encoding_rs`); le altre sono già nell'albero. `proptest`, `log`, `sha1` e
`miniz_oxide` sono definite soltanto nel workspace di questa cartella, perché
Fub non le nomina; `proptest` serve solo ai test dell'upstream.

Le dipendenze crittografiche del codec (`aes`, `sha1`, `sha2`, `hmac`, `cfb`,
`zeroize`) servono ad aprire e scrivere documenti protetti da password e
restano alle versioni dell'upstream; `sha2` e `zeroize` sono le stesse dei
disegni e della sessione live. `tauri-codegen` e `infer` ne tirano versioni più
vecchie solo in fase di compilazione di `fub-app`: `cargo deny` le segnala come
doppie, con la politica `warn` di Fub. Le righe `wordcraft-*` dei due
workspace portano la versione accanto al percorso, perché `cargo deny` non
consideri jolly una dipendenza fra crate pubblicabili.

`rustfmt.toml` sta qui per chi formatta questi file con le regole
dell'upstream. La struttura delle cartelle è la stessa dell'upstream, così gli
`include_bytes!` del crate (`../../../assets/…`) restano validi senza toccarli.

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
`tr_TR`, `id_ID`) non sono inclusi, come nell'upstream: il dizionario italiano è sotto
GPL. Il crate li legge dal sistema quando ci sono; senza, la lingua non ha
segni d'ortografia ma conserva le regole grammaticali.

## Aggiornare

La copia è derivata: l'upstream al commit di `upstream.lock` più le patch di
`patches/`, in ordine. Le modifiche elencate sopra sono quelle patch, una per
ragione; nessun file si modifica a mano.

```text
node tools/vendor-craft/vendor.mjs wordcraft update --rev <sha> [--tag <tag>] [--source <clone o URL>]
node tools/vendor-craft/vendor.mjs wordcraft check
node tools/vendor-craft/vendor.mjs wordcraft verify-upstream
node tools/vendor-craft/vendor.mjs wordcraft report --rev <sha> [--source <clone o URL>]
node tools/vendor-craft/vendor.mjs wordcraft gate
```

`update` estrae i percorsi gestiti (con `--tag`, controlla che il tag
dell'upstream punti a quel commit e lo scrive nel lock), porta la pila di patch sulla revisione nuova (una patch
il cui contesto è cambiato si rifà a tre vie e si riscrive in `patches/`; su un
conflitto vero si ferma, senza scrivere niente), stampa le dipendenze aggiunte o tolte
dai manifest dell'upstream, controlla che ogni dipendenza ereditata sia
definita nel workspace di questa cartella, scrive `upstream.lock` e aggiorna la
`version` del workspace di questa cartella e delle righe `wordcraft-*` dei due
`Cargo.toml`. `check`, in CI, toglie la pila intera in ordine inverso da una
copia e ritrova le impronte dell'upstream. Una modifica nuova si aggiunge come
patch in `patches/` e si riesegue `update` con lo stesso commit.

`report` è l'aggiornamento a vuoto: non scrive niente, e dice per ogni patch
se si applica così com'è, se si rifà a tre vie, se l'upstream l'ha assorbita o
se ha un conflitto vero, quali dei suoi file l'upstream ha cambiato, le
dipendenze aggiunte, tolte o prese da Git, la `rust-version` se supera quella
di Fub e i file `osservati` di `motori.mjs` che l'upstream ha cambiato: la
barra e la mini-barra dell'upstream, che Fub non copia ma da cui prende i
comandi. `self-test` prova le tre vie su un upstream finto, senza rete. `gate`, dopo `update`, esegue le prove che
`tools/vendor-craft/motori.mjs` elenca per il motore e le riassume in una
tabella.

Dopo un aggiornamento: i test qui sopra, con il `Cargo.lock` di questa
cartella aggiornato (`cargo update --manifest-path vendor/wordcraft/Cargo.toml
--workspace`), quelli di `fub-format-rich` con il suo corpus, quelli di
`fub-features` con la feature `proof` e `cargo deny check`. Il diff di
`UPDATE_CORPUS=1 cargo test -p fub-format-rich --test corpus` dice cosa è
cambiato; la prova lunga delle mutazioni è
`CORPUS_MUTATIONS=20000 cargo test --release -p fub-format-rich --test corpus
le_mutazioni`, e i tempi `cargo test --release -p fub-format-rich --test
corpus tempi -- --ignored --nocapture`.

Una correzione che serve a Fub va proposta all'upstream; finché non entra,
resta una patch.

Il perché di questa forma, e quando passare a una dipendenza Git o da
crates.io, è nell'[ADR 0213](../../docs/decisions/0213-provenienza-dei-motori-esterni.md).
