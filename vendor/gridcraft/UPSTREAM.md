# GridCraft vendorizzato

Questa cartella contiene codice di
[GridCraft](https://github.com/storytold/gridcraft), copiato con le poche
modifiche elencate qui sotto. Fub non dipende da GridCraft via Git:
`deny.toml` ammette soltanto crates.io, e i crate non sono pubblicati là.

Il fork [`Fubeo/gridcraft`](https://github.com/Fubeo/gridcraft) è il mirror: il campo
`mirror` di `upstream.lock` lo nomina, e `verify-upstream` lo prova dopo
l'upstream. Prende rami e tag dell'upstream senza potare e senza riscrivere un
tag, così una revisione copiata resta raggiungibile anche se l'upstream la
cancella.

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

| Percorso qui | Percorso upstream | Patch che lo toccano |
|---|---|---|
| `crates/core/` | `crates/core/` | nessuna |
| `crates/formula/` | `crates/formula/` | nessuna |
| `crates/functions/` | `crates/functions/` | nessuna |
| `crates/numfmt/` | `crates/numfmt/` | nessuna |
| `crates/model/` | `crates/model/` | `0005` (`src/sheet.rs`, `src/preserved.rs`); `0007` (`src/cell.rs`, `src/lib.rs`, `src/preserved.rs`, `src/sheet.rs`, `src/style.rs`) |
| `crates/calc/` | `crates/calc/` | nessuna |
| `crates/xlsx/` | `crates/xlsx/` | `0001` (`src/package.rs`, `src/ods.rs` e nove file di `src/tests/`); `0003` (`src/sheet_read.rs`); `0005` (`src/read.rs`, `src/passthrough.rs`, `src/write.rs`); `0006` (`src/array_formula.rs`, `src/fmla.rs`, `src/read.rs`, `src/sheet_write.rs`); `0007` (`src/array_formula.rs`, `src/csv.rs`, `src/drawing.rs`, `src/passthrough.rs`, `src/read.rs`, `src/sheet_read.rs`, `src/sheet_write.rs`, `src/styles.rs`, `src/write.rs`, `src/xls/mod.rs`, `src/xml.rs`); `0008` (`src/passthrough.rs`, `src/sheet_write.rs`); i test di `src/tests/` di ciascuna |
| `crates/chart/` | `crates/chart/` | nessuna |
| `crates/pdf/` | `crates/pdf/` | nessuna |
| `crates/engine/` | `crates/engine/` | `0001` (`tests/chart_workbook_names.rs`); `0004` (`src/lib.rs`); `0007` (`src/cmd/` analysis, edit, extra, forecast, format, insert, solver e whatif, `src/fill.rs`, `src/io.rs`, `src/pivot.rs`); `0009` (`src/lib.rs`, `src/chart_svg.rs`); `0010` (`src/cmd/insert.rs`); `src/tests.rs` per `0004`, `0006`, `0007` e `0010` |
| `rustfmt.toml` | `rustfmt.toml` | nessuna |
| `NOTICE` | `NOTICE` | nessuna |

L'elenco esatto dei file di ogni patch è nelle sue intestazioni `diff --git`,
e `vendor.mjs gridcraft report` lo incrocia con ciò che l'upstream cambia.

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
`forbid(unsafe_code)`. Con la 1.95 di Fub, e le patch qui sotto, i crate
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
  che leggono l'archivio `f.name()` diventa `f.name().unwrap()`. `zip` 9 porta
  `typed-path`, che dà a `[u8]` un `AsRef` in più: in `xlsx/src/ods.rs` un
  `r.as_ref()` non si inferisce più (E0308) e diventa `&*r`;
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
  (`crates/fub-format-xlsx/src/inventory.rs`);
- `0008-viste-ed-estensioni`: una cartella scritta da LibreOffice, riscritta
  senza modifiche, perdeva gli attributi di `<sheetView>` che il modello non
  ha (lo zoom del layout di pagina, `showOutlineSymbols`, `showRuler` e gli
  altri di `SHEET_VIEW_ATTRS`), lo `zoomScaleNormal` del file, sostituito
  dallo zoom, e le estensioni del documento che GridCraft non legge (l'upstream
  tiene soltanto `calcFeatures`). Ora gli attributi restano come sorgenti di
  `Preserved` (`zoomScaleNormal` finché lo zoom è quello letto), e un `<ext>`
  del documento resta com'era, con le dichiarazioni che gli servono, quando non
  nomina parti del pacchetto: uno che le nomina (le cache dei filtri, per
  esempio) si perde con un avviso, perché le parti si rinumerano. In
  `xlsx/src/tests/source_forms.rs` e `passthrough_tests.rs` i test lo dicono.
- `0009-svg-degli-oggetti`: Fub disegna i grafici e i grafici sparkline di
  una cartella come li disegna il salvataggio come pagina web, con le
  primitive di `chart`. In `engine/src/lib.rs` il modulo `chart_svg` diventa
  pubblico, e con lui `chart_svg` e `prims_svg`; il codice non cambia;
- `0010-modifica-di-note-e-commenti`: scrivere una nota, o un commento, su
  una cella che ne ha già uno dello stesso tipo ne sostituiva tutto il thread:
  «Modifica commento» perdeva le risposte, lo stato risolto e le date, e
  «Modifica nota» la casella letta dal file. In `engine/src/cmd/insert.rs` ora
  cambia soltanto il testo (e l'autore, se il comando lo nomina), come fa
  Modifica nota di Excel; una nota scritta su un commento lo sostituisce
  ancora. In `engine/src/tests.rs` il test lo dice.

### Le patch per tipo

Ogni patch ha un tipo, che dice quando può uscire dalla pila:

- **TEMPORARY-COMPAT**: adatta l'upstream a un vincolo di Fub (una
  dipendenza, la toolchain) e cade quando il vincolo cade o l'upstream lo
  segue;
- **UPSTREAM-BUGFIX**: corregge un comportamento dell'upstream che è un
  difetto anche per l'upstream; va proposta là, e cade quando entra;
- **UPSTREAM-API**: rende pubblico o aggiunge un punto d'ingresso che Fub
  usa; va proposta là come API, e cade quando l'upstream ne ha una
  equivalente;
- **FUB-SPECIFIC**: un comportamento che serve soltanto a Fub. Nessuna patch
  di questa pila lo è: ciò che è di Fub sta in `fub-format-xlsx`.

| Patch | Tipo | Il test di Fub che ne dipende | Upstream | Quando cade |
|---|---|---|---|---|
| `0001-zip-9` | TEMPORARY-COMPAT | `cargo deny check` (gli avvisi di `zip` 3) | da proporre: passare a `zip` 9 | quando l'upstream usa `zip` ≥ 9 |
| `0003-valori-delle-matrici` | UPSTREAM-BUGFIX | `display.rs`: `le_celle_versate_hanno_i_valori_del_file_e_niente_si_ricalcola` | storytold/gridcraft#2137, accanto a #2048 | quando #2137 entra |
| `0004-apertura-senza-ricalcolo` | UPSTREAM-API | `fub-format-xlsx` chiama `DocState::from_saved`; `commands.rs`: `un_comando_non_ricalcola_le_formule_che_non_tocca` | da proporre: `DocState::from_saved` (o un'opzione di apertura) | quando l'upstream apre senza ricalcolare |
| `0005-sheetid-del-file` | UPSTREAM-BUGFIX | `fub-format-xlsx` legge `Sheet::file_id`; `commands.rs`: `i_fogli_nuovi_hanno_id_che_il_giornale_ritrova`; l'inventario, che riconosce i fogli dal `sheetId` | da proporre | quando lo scrittore tiene il `sheetId` letto |
| `0006-intersezione-implicita` | UPSTREAM-BUGFIX | il corpus esterno (`tests/corpus.rs` con `FUB_XLSX_CORPUS`), le formule legacy; nessun test interno la isola | da proporre | quando il lettore distingue le formule senza `cm` |
| `0007-forme-del-file` | UPSTREAM-BUGFIX | il corpus esterno (`tests/corpus.rs` con `FUB_XLSX_CORPUS`): le venti cartelle di POI restano modificabili; nessun test interno la isola | da proporre, divisa per oggetto (testo ricco, `x14`, VML, disegni, stili) | quando lo scrittore riusa le forme lette; è la patch più grande (3.200 righe) e la più costosa da tenere |
| `0008-viste-ed-estensioni` | UPSTREAM-BUGFIX | `corpus.rs`: `ogni_cartella_del_corpus_ha_la_sua_classe` (la cartella `viste-di-libreoffice`, che senza la patch diventa preservabile) | da proporre | quando `<sheetView>` e gli `<ext>` del documento restano |
| `0009-svg-degli-oggetti` | UPSTREAM-API | `objects.rs` chiama `chart_svg` e `prims_svg` | da proporre: `chart_svg` pubblico | quando il modulo è pubblico |
| `0010-modifica-di-note-e-commenti` | UPSTREAM-BUGFIX | `commands.rs`: `modificare_un_commento_tiene_le_risposte` | da proporre | quando «Modifica commento» tiene il thread |

Senza `0005` o `0009` `fub-format-xlsx` non compila, e senza `0008` o
`0010` il test della tabella fallisce: lo si è provato togliendo ciascuna
dalla pila. `0003`, `0004`, `0006` e `0007` non si tolgono da sole, perché
le patch che le seguono ne hanno il contesto: `0006` chiede `0004` (soltanto
nei test), `0007` chiede `0003` e `0006`, `0008` chiede `0007`. Le altre si
applicano da sole su `v0.11.1`.

Le patch da proporre non sono ancora issue né PR dell'upstream: aprirle è
una scelta di chi mantiene Fub.

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
node tools/vendor-craft/vendor.mjs gridcraft report --rev <sha> [--source <clone o URL>]
node tools/vendor-craft/vendor.mjs gridcraft gate
```

`update`, `check` e `verify-upstream` fanno ciò che fanno per WordCraft
([`vendor/wordcraft/UPSTREAM.md`](../wordcraft/UPSTREAM.md)). Un
aggiornamento va così:

1. `report --rev <sha>` è l'aggiornamento a vuoto: per ogni patch dice se si
   applica così com'è, se si rifà a tre vie sui file nuovi (e quale sua parte
   cade perché l'upstream ha tolto il file), se l'upstream l'ha assorbita (la
   patch esce, e la sua riga qui sopra con lei) o se ha un conflitto vero, e
   quali dei file che tocca l'upstream ha cambiato; poi le dipendenze dirette
   aggiunte e tolte, quelle da Git, le versioni del workspace, la
   `rust-version` se supera quella di Fub e i file `osservati` di
   `motori.mjs` che l'upstream ha cambiato (la barra dei fogli in TS ricopia
   `ui-egui/src/ribbon.rs`, che non si copia). Non tocca la copia.
2. `update --rev <sha>`, con il `Cargo.lock` di questa cartella aggiornato
   (`cargo update --manifest-path vendor/gridcraft/Cargo.toml --workspace`).
   Le patch rifatte a tre vie si riscrivono in `patches/` da sole; su un
   conflitto vero `update` si ferma senza scrivere niente, e la patch si
   rifà a mano.
3. `gate` esegue le prove di `tools/vendor-craft/motori.mjs` e le riassume:
   `check`, i test di GridCraft, quelli di `fub-format-xlsx` e di `fub-host`
   (`xlsx_workbooks`), il confine del motore, gli invarianti di dipendenza e
   `cargo deny check`. Con `FUB_XLSX_CORPUS=<cartella>` i test di
   `fub-format-xlsx` classificano anche un corpus esterno.

Nei test di `fub-format-xlsx` tre file dicono che cosa è cambiato per la
shell, e un loro diff va guardato prima di rigenerarli:

- `tests/fixtures/catalogo-servito.tsv`, i comandi che Fub serve con i loro
  parametri (`UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --lib
  catalogo_servito`). Il catalogo è un elenco di esclusioni: un comando nuovo
  dell'upstream si serve da sé, e questo diff lo mostra;
- la fixture della griglia (`UPDATE_MIRROR=1 cargo test -p fub-format-xlsx
  --test ts_grid`), ciò che la griglia mostra;
- `tests/corpus.rs`, la classe di ogni cartella del corpus (modificabile,
  preservabile, rifiutata) e il punto fisso del salvataggio.

Una correzione che serve a Fub va proposta all'upstream; finché non entra,
resta una patch.

Il perché di questa forma è nell'[ADR 0213](../../docs/decisions/0213-provenienza-dei-motori-esterni.md);
il ruolo di GridCraft in Fub nell'[ADR 0214](../../docs/decisions/0214-gridcraft-motore-del-foglio-di-calcolo.md).
