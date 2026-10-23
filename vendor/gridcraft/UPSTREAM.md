# GridCraft vendorizzato

Questa cartella contiene codice di
[GridCraft](https://github.com/storytold/gridcraft), copiato con le poche
modifiche elencate qui sotto. Fub non dipende da GridCraft via Git:
`deny.toml` ammette soltanto crates.io, e i crate non sono pubblicati là.

Dieci crate: quelli del dominio del foglio di calcolo, cioè i tipi comuni
(`core`), il parser delle formule (`formula`), le funzioni (`functions`), i
formati numerici (`numfmt`), il modello della cartella (`model`), il calcolo
(`calc`) e i codec dei file (`xlsx`); i grafici (`chart`) e lo scrittore di
PDF (`pdf`); e la facciata (`engine`), con la sessione, i comandi della barra
multifunzione e la cronologia. Li usa soltanto `fub-format-xlsx`.
L'interfaccia (`ui-egui`) e il server MCP (`mcp`) non sono copiati.

## Riferimento

- repository: `https://github.com/storytold/gridcraft`
- commit: `ac8da7d49cbeb4be6aa1ad5869f3d29fe2da8cd9` (tag `v0.11.1`, 2026-10-22)
- licenza del codice: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)

## Cosa è copiato

| Percorso qui | Percorso upstream | Modifiche |
|---|---|---|
| `crates/core/` | `crates/core/` | nessuna |
| `crates/formula/` | `crates/formula/` | nessuna |
| `crates/functions/` | `crates/functions/` | `src/engineering.rs`, per Rust 1.89 |
| `crates/numfmt/` | `crates/numfmt/` | nessuna |
| `crates/model/` | `crates/model/` | `src/sheet.rs` e `src/preserved.rs`, per il `sheetId` del file |
| `crates/calc/` | `crates/calc/` | nessuna |
| `crates/xlsx/` | `crates/xlsx/` | `src/package.rs` e nove file di `src/tests/` per `zip` 9; `src/ods.rs` per Rust 1.89; `src/sheet_read.rs` e `src/tests/fixtures.rs` per i valori delle matrici; `src/read.rs`, `src/passthrough.rs`, `src/write.rs` e `src/tests/sheet_names.rs` per il `sheetId` del file |
| `crates/chart/` | `crates/chart/` | nessuna |
| `crates/pdf/` | `crates/pdf/` | nessuna |
| `crates/engine/` | `crates/engine/` | `src/lib.rs` e `src/tests.rs`, per aprire senza ricalcolo; `tests/chart_workbook_names.rs` per `zip` 9 |
| `rustfmt.toml` | `rustfmt.toml` | nessuna |
| `NOTICE` | `NOTICE` | nessuna |

I manifest dei crate sono quelli dell'upstream. Ereditano versione, edizione,
licenza, lint e dipendenze da `Cargo.toml` di questa cartella, che è di Fub e
non dell'upstream: un workspace con i dieci crate, fuori da quello di Fub
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
compilano e i loro test passano. Come nell'upstream, il profilo `dev` di
questa cartella ha `opt-level = 1`: senza ottimizzazione l'analisi della
catena di 4.096 operandi di `formula/tests/spanish_input.rs` esaurisce la
pila di un thread di test.

Le patch di `patches/`, una per ragione:

- `0001-zip-9`: l'upstream usa `zip` 3, che ha tre avvisi di sicurezza
  (RUSTSEC-2026-0367, -0368, -0369) corretti in `zip` 9. In `zip` 9 il nome di
  una voce dell'archivio è un `Result`: in `xlsx/src/package.rs` un pacchetto
  con il nome di una voce illeggibile si rifiuta con l'errore dell'archivio, e
  la parte troppo grande con un nome illeggibile si dice senza nome; nei nove
  file di `xlsx/src/tests/` e nel test `engine/tests/chart_workbook_names.rs`
  che leggono l'archivio `f.name()` diventa `f.name().unwrap()`;
- `0002-rust-1-89`: l'upstream dichiara `rust-version = "1.90"` ma usa
  `std::f64::consts::EULER_GAMMA`, stabile dalla 1.94, in
  `functions/src/engineering.rs`, che qui ha lo stesso valore scritto per
  esteso; in `xlsx/src/ods.rs` un `r.as_ref()` che la 1.89 non sa inferire
  (E0308) diventa `&*r`. Il codice è lo stesso sul `main` dell'upstream, e la
  dichiarazione va corretta là;
- `0003-valori-delle-matrici`: il lettore scarta i valori che il file ha
  salvato nelle celle versate da una matrice, dinamica o legacy, perché la
  formula le riempia di nuovo (storytold/gridcraft#2137, accanto a
  storytold/gridcraft#2048), e per ritrovarli bisogna ricalcolare la cartella.
  In `xlsx/src/sheet_read.rs` quei valori vanno nella mappa `spill` del foglio,
  che `Sheet::value` legge già e che il ricalcolo svuota, e l'area versata di
  una matrice dinamica va in `spill_ranges`, che la scrittura usa per il
  `ref`. La ricerca della matrice che contiene una cella non scorre più tutte
  le matrici lette: con molte matrici la lettura era quadratica (120.000
  matrici in 4 s). In `xlsx/src/tests/fixtures.rs` il test dice che i valori
  restano visibili;
- `0004-apertura-senza-ricalcolo`: `DocState::new` ricalcola tutta la
  cartella, e i valori salvati nel file cambiano anche dove nessuno ha
  modificato niente (funzioni volatili, funzioni che GridCraft non ha, cicli).
  `DocState::from_saved` costruisce il grafo delle dipendenze senza valutare,
  così ogni valore resta quello del file finché una modifica non lo
  raggiunge. In `engine/src/tests.rs` il test lo dice;
- `0005-sheetid-del-file`: lo scrittore numera i `sheetId` da 1 nell'ordine
  dei fogli, e una cartella riscritta cambia l'id di un foglio che non è il
  primo di una serie senza buchi. Ciò che riconosce un foglio dal suo id
  (le parti che il codec porta così come sono, e per Fub i comandi del
  giornale dati dopo un salvataggio) lo perderebbe. Il modello tiene il
  `sheetId` letto (`Sheet::file_id`, `PreservedSheet::sheet_id`, fuori dal
  JSON) e lo scrittore lo riscrive; un foglio nuovo, o copiato da un altro con
  lo stesso id, prende il primo id che nessun foglio chiede. In
  `xlsx/src/tests/sheet_names.rs` il test lo dice;
- `0006-intersezione-implicita`: una formula salvata senza i metadati delle
  matrici dinamiche (un file di Excel 2016 o precedente, o una cella senza
  `cm`) Excel la valuta con l'intersezione implicita, mentre GridCraft la
  legge come una formula dinamica: `C7+G7:J7` versa una matrice dove il file
  aveva un valore solo. In `xlsx/src/array_formula.rs` il lettore la porta
  nella forma con `@` (`C7+@G7:J7`) dove Excel interseca, seguendo i
  parametri delle funzioni che prendono un valore solo, e la lascia com'è
  quando l'analisi non sa concludere; lo scrittore riscrive senza `@` ciò che
  Excel rilegge allo stesso modo. In `xlsx/src/tests/legacy_formulas.rs` e
  `engine/src/tests.rs` i test lo dicono;
- `0007-forme-del-file`: una cartella riscritta senza modifiche cambia ciò che
  il modello non distingue: il testo formattato di una cella e di una nota,
  il testo mostrato di un collegamento, le regole di Excel 2010
  (`x14:conditionalFormattings`, con l'URI giusto
  `{78C0D931-6437-407d-A8EE-F0AAD7539E65}` al posto di quello che l'upstream
  scrive), il disegno VML delle note, i disegni e i grafici, gli stili, la
  larghezza predefinita zero e le formule legacy che lo `0006` non porta. Il
  modello tiene la forma letta accanto all'oggetto che la produce
  (`Cell::rich`, le sorgenti di `Preserved`/`PreservedSheet` con il modello
  da cui vengono), e lo scrittore la riusa finché quell'oggetto è lo stesso;
  un oggetto cambiato si scrive nella forma di GridCraft. In
  `xlsx/src/tests/source_forms.rs`, `note_box.rs` e `legacy_formulas.rs` i
  test lo dicono, e con queste patch le venti cartelle del corpus di Apache
  POI riscritte senza modifiche hanno lo stesso inventario
  (`crates/fub-format-xlsx/src/inventory.rs`).

Le dipendenze del workspace di questa cartella hanno, per quelle in comune con
Fub, la stessa versione del `[workspace.dependencies]` di Fub, perché il grafo
dei due workspace sia lo stesso (lo controlla `vendor.mjs check`). Rispetto
all'upstream:

- `zip` passa da 3 a 9.0.5, per gli avvisi qui sopra;
- `serde_json` non accende `float_roundtrip`: serve soltanto ai test
  dell'upstream, e le feature si unificano in tutto il grafo di Fub.

I dieci crate non portano nessuna libreria nuova nell'albero di Fub: ogni loro
dipendenza c'è già, compresa `image` (con i decodificatori PNG e JPEG) di
`engine`. Le righe `gridcraft-*` dei due workspace portano la
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
`xlsx_workbooks`) e `cargo deny check`. Se ciò che la griglia mostra cambia,
la fixture della griglia si rigenera con `UPDATE_MIRROR=1 cargo test -p
fub-format-xlsx --test ts_grid`, e il suo diff dice cosa vede di diverso la
shell.

Una correzione che serve a Fub va proposta all'upstream; finché non entra,
resta una patch.

Il perché di questa forma è nell'[ADR 0213](../../docs/decisions/0213-provenienza-dei-motori-esterni.md);
il ruolo di GridCraft in Fub nell'[ADR 0214](../../docs/decisions/0214-gridcraft-motore-del-foglio-di-calcolo.md).
