# Piano: N3 · La logica della lavagna scende in Rust

Branch: piano/n3-logica-in-rust
Obiettivo: ogni modifica a una lavagna (`.canvas`) passa da un nucleo Rust
solo, che gira nell'host (comandi, CLI, MCP), nei test e nella WebView come
WebAssembly; un agente crea e cambia una lavagna con `fub_canvas_create` e
`fub_canvas_apply`, e la shell la mostra uguale.
Perché: oggi la logica della lavagna (leggere, cambiare, riscrivere il
sorgente) vive solo in TypeScript (`apps/client/src/editors/canvas/`), quindi
un agente non la raggiunge e le regole di lettura di Rust e TypeScript non
sono le stesse (prova 2).
Fuori scope: le ancore e il formato `fub:ink` (N4); le operazioni
`AddStrokes`/`EraseStrokes` (N4); togliere la copia TypeScript
dell'inchiostro (qui si misura soltanto, T17); unificare `json_map.rs` di
`fub-format-canvas` col nucleo; un `ParamKind` JSON o una superficie «solo per
gli agenti» nell'ABI dei comandi; la pagina di prodotto `product/lavagna.md`;
i sottocomandi `fub canvas …` della CLI; bottoni nuovi nell'interfaccia
oltre ai due comandi della tavolozza.
Assunzioni: A1–A12 e il contratto R1–R10 qui sotto, decisi dal pianificatore
il 2026-11-02 di notte (l'utente non poteva rispondere; le domande sono in
«Domande per l'utente», e ogni task che dipende da una risposta costosa da
disfare sta in un'ondata dopo).
Ondate: T1 T2 | T3 T4 T6 | T5 T8 | T7 | T9 T10 | T11 | T12 | T13 | T14 | T15 | T16 T17 | T18
Prototipo: nessuno. N3 non ha grafica nuova. Testi visibili nuovi: i titoli e
le descrizioni dei due comandi (T10, T11), la riga «Lavagna» in Impostazioni →
Componenti (T10), i messaggi d'errore dei comandi (T10, T11) e l'avviso se il
nucleo non si carica (T16).

## Modifiche

nessuna

## Fonti

- Il passo 12a dei «Piani di Fub» (N3) e, per ciò che N4 e N6 si aspettano,
  il passo 12b (ancore, `fub:ink`). I coder non li leggono: qui c'è ciò che
  serve, e dove il codice dice altro vince il codice (sezione «Differenze»).
- Il codice di oggi: `crates/fub-format-canvas/src/{model,parse}.rs`,
  `apps/client/src/editors/canvas/{model,operation,source-edit,engine}.ts`,
  il metodo dello specchio dell'inchiostro (`crates/fub-ink/tests/ts_mirror.rs`
  e `apps/client/src/ink/__fixtures__/ink-samples.json`) e quello dei vettori
  della scena (`crates/fub-scene/tests/ops_vectors.rs`,
  `apps/client/src/editors/spatial/scene/vectors.test.ts`,
  `apps/client/src/__fixtures__/scene-ops/`).
- I comandi: `crates/fub-features/src/commands.rs` (lettura, `EditRequest`,
  `PlannedEdit`, `Undo::of_edits`) e `crates/fub-features/src/draw/create.rs`
  (nome libero, `create_document`, `Navigate`, annulla nel cestino).
- L'MCP: `crates/fub-cli/src/mcp/tools.rs` e `access.rs`.
- Scritto su main @ 620f0acd (2026-11-02).

## Domande per l'utente (raccolte, non bloccano)

Il piano procede con la prima opzione di ognuna.

- D-1 · Come parla la WebView col nucleo (T13, T14). (a) Consigliata:
  un'interfaccia C scritta a mano, JSON dentro e fuori, nessuna libreria
  nuova: la prova 1 dà 56 KB compressi e nessun import. (b) `wasm-bindgen`
  come nel passo 12a: più comodo da scrivere, ma è una dipendenza nuova, più
  `wasm-bindgen-cli` della stessa versione in ogni macchina e job che
  costruisce il client. Cambiare idea dopo T13 vuol dire riscrivere T13 e il
  caricatore di T14.
- D-2 · Da dove viene il file `.wasm` (T14). (a) Consigliata: lo compila
  Vite dai sorgenti a ogni build; serve Rust col bersaglio
  `wasm32-unknown-unknown` dovunque si lanci `npm` (in locale e in ogni job
  della CI che costruisce o prova il client). (b) Un `.wasm` committato e una
  guardia che lo confronta coi sorgenti: niente Rust per chi lavora solo sul
  client, ma un binario nel repo. (c) Uno script separato prima di Vite.
- D-3 · Sicurezza della WebView (T15, T16). (a) Consigliata: aggiungere solo
  `'wasm-unsafe-eval'` a `script-src` nella CSP di
  `crates/fub-app/tauri.conf.json` (permette di compilare WebAssembly, non di
  eseguire testo come JavaScript). (b) Niente WebAssembly nella WebView: N3 si
  ferma a T12 (comandi e MCP sì), la tela resta in TypeScript e le due copie
  restano tenute uguali dai vettori.
- D-4 · L'inchiostro (T17). (a) Consigliata: in N3 solo la misura in
  `bench:ink`; la copia TypeScript resta, come vuole la decisione 0204 (niente
  WebAssembly a ogni evento del puntatore). (b) Portarlo ora, se la misura
  regge: va contro 0204 e va deciso con una decisione nuova.
- D-5 · Il testo di una scheda (T16). Oggi ogni tasto premuto è una modifica
  salvata e un passo d'annulla. (a) Consigliata: la modifica si registra dopo
  una pausa di circa 250 ms, all'uscita dal campo, a Invio e a Esc; un
  «annulla» toglie una frase, non una lettera. (b) Solo all'uscita dal campo.
  In tutti e due i casi niente chiamata al nucleo per ogni tasto
  (`CLAUDE.md`: «No IPC or WASM per keystroke»).
- D-6 · Che cosa vede l'utente (T10, T11). (a) Consigliata: un componente
  «Lavagna» nuovo, con la sua riga in Impostazioni → Componenti (spegnerlo
  toglie i due comandi), e nella tavolozza «Nuova lavagna» e «Applica
  operazioni alla lavagna» (il secondo chiede un testo JSON: la tavolozza
  mostra tutti i comandi, e nasconderne uno vorrebbe un cambio dell'ABI). (b)
  I due comandi dentro il componente dei comandi delle note, senza riga
  nuova. Facile da cambiare dopo: si sposta un modulo.
- D-7 · Che cosa si apre e come si riscrive (T2, T3). (a) Consigliata: le
  regole R1–R10 così come sono scritte: si aprono anche coordinate `1.0` o
  `1e2` e campi `null`, un file con solo il BOM è una lavagna vuota, i `null`
  dei campi noti spariscono quando Fub riscrive quella scheda; restano
  rifiutati decimali veri, chiavi note doppie, surrogati spaiati. (b) Più
  severe (rifiutare `1.0` e i `null`). Facile da cambiare dopo: è codice di
  lettura, e i vettori dicono che cosa cambia.
- D-8 · Togliere il TypeScript (T18). (a) Consigliata: dopo la parità si
  tolgono `parseCanvas`, le toppe e il riscrittore TypeScript, e con loro i
  loro test, i cui casi devono essere prima nei vettori (togliere un test è
  una voce di «Chiede sempre»). (b) Tenere la copia TypeScript come seconda
  via, tenuta uguale dallo specchio.

## Assunzioni

- A1 · **Due livelli di operazioni.** Il TypeScript di oggi non ha operazioni
  d'intento: ha toppe con l'immagine di prima (`CanvasPatch` in
  `operation.ts`: `upsert-node`, `remove-node`, `upsert-edge`, `remove-edge`,
  `reorder`). Il nucleo le porta come sono, con la stessa forma JSON, e sopra
  aggiunge le operazioni d'intento del passo 12a (`CanvasOp`), che si
  compilano in toppe. L'inversa si calcola sulle toppe, non sulle operazioni.
- A2 · **Il sorgente si ritocca, non si riscrive.** Come `patchCanvasSource`
  di oggi: si cambiano solo i valori e gli oggetti toccati, il resto del file
  resta byte per byte. Il `source()` del passo 12a, che serializza tutto,
  perderebbe la forma del file.
- A3 · **Il nucleo è piccolo.** `fub-canvas-core` dipende solo da `serde`,
  `serde_json` (con `float_roundtrip`) e `thiserror`. Niente `fub-abi`,
  niente Markdown: il BOM lo gestisce da sé.
- A4 · **`float_roundtrip` vale per tutto il grafo.** Le feature di Cargo si
  uniscono: dove c'è il nucleo, ogni `serde_json` legge i decimali esatti (un
  po' più lento). La prova 3 dice perché serve.
- A5 · **La facciata WebAssembly è un membro `rlib`.** Il `.wasm` si fa con
  `cargo rustc -p fub-canvas-wasm --lib --release --target
  wasm32-unknown-unknown --crate-type cdylib`, con le opzioni di profilo da
  variabili d'ambiente (`CARGO_PROFILE_RELEASE_OPT_LEVEL=s`, `LTO=true`,
  `PANIC=abort`, `STRIP=true`, `CODEGEN_UNITS=1`) e un `CARGO_TARGET_DIR`
  suo (`target/canvas-wasm`). Così niente profilo nuovo nella radice e niente
  `cdylib` nel manifesto (`check-crate-type.mjs` resta com'è).
- A6 · **Il nucleo resta in memoria.** Si carica alla prima lavagna aperta e
  resta; ogni lavagna aperta ha la sua istanza logica (un handle). La prova 1
  dice che aprire da capo a ogni gesto costerebbe troppo.
- A7 · **Il componente.** Bundle `fub.lavagna`, feature di Cargo `lavagna`
  nel `default` di `fub-features` (con `dep:fub-canvas-core` opzionale),
  modulo `crates/fub-features/src/lavagna.rs` con `lavagna/`. Le operazioni
  arrivano al comando come parametro `Text` con dentro JSON, perché non esiste
  un `ParamKind` JSON.
- A8 · **I vettori scritti a mano** stanno accanto a quelli della scena:
  `apps/client/src/__fixtures__/canvas-patches/` (toppe sul testo) e
  `apps/client/src/__fixtures__/canvas-ops/` (operazioni sul modello). Sono
  oracoli: non li genera il codice che verificano.
- A9 · **Lo specchio generato.** `crates/fub-canvas-core/tests/ts_mirror.rs`
  genera `apps/client/src/__fixtures__/canvas-mirror.json` (con
  `UPDATE_MIRROR=1`, come l'inchiostro), e
  `apps/client/src/editors/canvas/mirror.test.ts` lo fa girare in TypeScript.
- A10 · **Gli id nuovi** delle operazioni d'intento vengono da un seme del
  chiamante: 16 cifre esadecimali come quelli di Obsidian, saltando quelli già
  presi. Stesso seme, stesso id: i vettori e l'annulla restano deterministici.
  Gli id che crea la tela (`newNodeId` di `operation.ts`) restano quelli di
  oggi.
- A11 · **`fub:ink` è un campo sconosciuto.** In N3 si conserva come ogni
  campo che il nucleo non conosce (sulla radice e sulle schede). Spostare una
  scheda non tocca l'inchiostro: con le ancore relative di N4 si muoverà da
  sé. Il vettore `move-with-ink.json` del passo 12a lo prova già.
- A12 · **La decisione nuova** (WebAssembly nella WebView, la CSP, l'ABI C)
  prende il primo numero libero in `docs/decisions/` al momento del merge
  (oggi 0236; altri piani di stanotte potrebbero prenderlo prima).
- A13 · **Strumenti MCP propri.** `fub_canvas_create` e `fub_canvas_apply`
  come vuole il passo 12a, e non solo `fub_invoke`: `fub_invoke` vuole tutto
  il vault leggibile, questi controllano le radici documento per documento.

## Il contratto di lettura e scrittura (R1–R10)

La regola generale: Rust e TypeScript fanno la stessa cosa; nel dubbio si
apre e si conserva; ogni caso qui sotto diventa un vettore scritto a mano.

- R1 · **Vuoto** è: un BOM facoltativo, poi solo spazi JSON (spazio, `\t`,
  `\n`, `\r`). Una lavagna vuota. Oggi Rust usa `trim()` di Unicode (U+0085
  conta come spazio) e TypeScript `trim()` di JavaScript (il solo BOM conta
  come vuoto): tutti e due cambiano.
- R2 · **Numeri dei campi noti** (`x`, `y`, `width`, `height`): valori interi
  entro ±(2^53−1), quindi `1.0`, `1e2` e `-0` vanno bene; una frazione vera o
  un valore più grande è un errore. `width` e `height` almeno 1, come oggi.
- R3 · **Chiavi doppie.** Una chiave nota doppia sulla radice, in una scheda
  o in un arco è un errore. Una chiave sconosciuta doppia tiene l'ultimo
  valore nella posizione della prima (come `JSON.parse`). Il riscrittore
  rifiuta un sorgente con chiavi doppie a qualunque profondità (come oggi).
- R4 · **Un surrogato spaiato** (`"\ud800"`), in una chiave o in un valore, è
  un errore.
- R5 · **Un numero fuori dal campo di un `f64`** (`1e400`) è un errore,
  dovunque sia.
- R6 · **Scrivere è `JSON.stringify`.** Lo stesso escape (solo `"`, `\\`, i
  controlli; `/` e i caratteri non ASCII restano come sono), lo stesso numero
  di `Number.prototype.toString` (anche per i numeri dei campi sconosciuti,
  che si scrivono come li riscriverebbe JavaScript dopo averli letti), lo
  stesso ordine delle chiavi di un oggetto JavaScript. Un sorgente nuovo è
  rientrato di due spazi e chiuso da `"\n"`, e tiene BOM e CRLF del file.
- R7 · **`null`** su un campo noto facoltativo, e `"nodes": null` o
  `"edges": null`, vogliono dire «assente». Quando Fub riscrive quella scheda,
  il `null` sparisce.
- R8 · **`backgroundStyle`** accetta qualunque stringa e la conserva; un
  valore che la tela non conosce si disegna come assente. Lo schema
  `canvas-v1.schema.json` resta com'è: dice ciò che Fub scrive.
- R9 · **L'immagine di prima** di una toppa si confronta come valore JSON: le
  chiavi in qualunque ordine, i numeri per valore. Oggi `sameValue` di
  `operation.ts` confronta `JSON.stringify` e quindi l'ordine: cambia.
- R10 · **Ordine dei campi** di una scheda o di un arco scritti per intero:
  quello della struct Rust (id, type, x, y, width, height, color, text, file,
  subpath, url, label, background, backgroundStyle; per gli archi id,
  fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label), poi i
  campi sconosciuti nel loro ordine, poi la regola di JavaScript (le chiavi
  che sembrano indici vanno prima, in ordine crescente). Una chiave aggiunta
  a un oggetto che c'era va in fondo.

## Prove fatte

Fuori dal repo, sotto `~/.cache/fub-k1/tmp/n3`, e poi cancellate.

1. **Il modello compila a `wasm32-unknown-unknown` senza `wasm-bindgen`**,
   con un'interfaccia `extern "C"` scritta a mano: build in circa 5 s; con
   `opt-level` s/z, LTO, `panic=abort` e `strip`, circa 147 KB (56 KB
   compressi), nessun import, istanza in circa 6 ms in Node. Con 2000 schede
   (944 KB), leggere, spostare e riscrivere da capo in WebAssembly costa
   13,5–19,5 ms contro 4–6 ms del TypeScript: il nucleo deve restare in
   memoria e ritoccare, non rileggere tutto (A2, A6).
2. **Le letture divergono oggi.** `1.0`/`1e2` nelle coordinate: TypeScript
   apre, Rust no. Interi oltre 2^53: Rust esatto, TypeScript arrotonda. Chiave
   nota doppia: Rust errore, TypeScript tiene l'ultima. Chiave sconosciuta
   doppia: tutti e due tengono l'ultima. Solo il BOM: TypeScript vuoto, Rust
   errore. Solo U+0085: Rust vuoto, TypeScript errore. Surrogato spaiato:
   TypeScript apre, Rust no. `null` e `"nodes": null`: TypeScript assente,
   Rust errore su `nodes` (dedotto dal codice, non provato). Il serializzatore
   del modello Rust toglie `edges` vuoto. Da qui R1–R10.
3. **`serde_json` senza `float_roundtrip`** legge male 592 947 numeri a caso
   su 1 999 009; con la feature, nessuno.
4. **`Number.prototype.toString` in Rust**: le cifre più corte di `{:e}`
   sbagliano 32 numeri su 299 928, tutti pareggi esatti; scegliendo nel
   pareggio la cifra pari, decisa sull'espansione esatta
   (`format!("{:.1100e}", x)`), nessuno. Non serve `ryu-js`.
5. **Le stranezze di JavaScript** da imitare: le chiavi che sembrano indici
   vanno prima in ordine crescente; `-0` si scrive `0`; `1e21` si scrive
   `1e+21`; `__proto__` è una chiave come le altre.

## Differenze dal passo 12a

Il passo dice di scriverle in `piani/STATO.md`; il brief di stanotte dice qui.

- Le operazioni TypeScript di oggi sono toppe con l'immagine di prima, non
  operazioni d'intento: il nucleo porta le toppe e ci mette sopra `CanvasOp`
  (A1). L'inversa del vettore del passo (`inverse: [move -40]`) diventa una
  lista di toppe.
- Il passo riscrive tutto il file (`source()`); il codice di oggi ritocca il
  sorgente (A2), e così resta.
- `fub-format-canvas` dipende da `fub-abi` e dal Markdown: il modello si
  stacca in un crate suo, non si sposta il crate intero.
- `wasm-bindgen` è una dipendenza nuova («Chiede sempre»): il piano usa
  un'interfaccia C (D-1, prova 1).
- La CSP della WebView (`script-src 'self'`) non lascia compilare
  WebAssembly (D-3), e i job `npm` della CI non hanno Rust (D-2).
- La decisione 0204 e `CLAUDE.md` vietano WebAssembly a ogni evento del
  puntatore e a ogni tasto: l'inchiostro qui si misura soltanto (D-4), e il
  testo delle schede, che oggi salva a ogni tasto, si raggruppa (D-5).
- `fub_invoke` vuole tutto il vault leggibile: servono strumenti MCP propri
  (A13).
- Le ancore e `InkLayer` (`pub mod ink` nello schizzo) sono di N4.
- Le fixture del passo (`fixtures/canvas-ops/`) vanno dove stanno quelle
  della scena (A8).
- La riga `fub.lavagna` della mappa dei componenti è `senza_bundle`, e non
  esiste un comando che crea una lavagna: T10 e T11 li fanno.
- `serde_json` legge male i decimali senza `float_roundtrip` (prova 3, A4).
- Non esiste un `ParamKind` JSON: le operazioni passano come testo (A7).

## Cancello di N3

| Fatto quando | Prova | Task |
|---|---|---|
| tutti i vettori passano in Rust e in TypeScript | `cargo test -p fub-canvas-core`; `cd apps/client && npx vitest run src/editors/canvas` (motore TypeScript e nucleo WebAssembly sugli stessi file) | T7, T8, T14 |
| lo specchio a caso non trova divergenze | `cargo test -p fub-canvas-core --test ts_mirror` e `mirror.test.ts` | T9 |
| un agente crea una lavagna, aggiunge schede e archi, e la shell la mostra uguale | `cargo test -p fub-cli --test mcp` (il testo scritto è quello del vettore `canvas-ops/agent-board.json`); il test della tela apre lo stesso testo e disegna le stesse schede negli stessi posti | T12, T16 |
| la tela usa il nucleo, e il TypeScript della lavagna si toglie | `engine.ts` non importa più `model.ts`/`operation.ts`/`source-edit.ts` per leggere o scrivere; quei file non hanno più la logica | T16, T18 |
| la WebView carica il nucleo e i tempi reggono | la pagina in `docs/misure/` con dimensione, istanza e un commit a 50 e 2000 schede in Node e in WebKitGTK | T15 |
| l'inchiostro in WebAssembly non è più lento di quello TypeScript | `npm run bench:ink`, la pagina in `docs/misure/`; l'esito decide solo se aprire la domanda D-4 (b) | T17 |

## Regole che valgono per ogni task

- Vince il codice: se un percorso o una funzione non è come scritto qui, il
  coder lo dice nel suo rapporto e segue il codice.
- Nessuna dipendenza esterna nuova (né `wasm-bindgen`, né `ryu-js`, né altro)
  senza la risposta a D-1.
- Il nucleo non va in panico su un input: ogni errore è un `Result` con un
  enum di `thiserror`; niente `unwrap` o `expect` nei sorgenti di
  `fub-canvas-core` fuori dai test. `unsafe` solo in
  `crates/fub-canvas-wasm/src/abi.rs`, con un commento `SAFETY` per blocco.
- In `fub-features` nessun `PluginError` letterale nuovo:
  `check-error-literals.mjs` è un cricchetto. I messaggi passano da chiavi del
  catalogo (`Text::message`), in italiano e in inglese.
- Testi della shell in `apps/client/src/i18n/catalog.ts`, con la chiave in
  tutte le lingue; il gergo vietato di `apps/client/src/i18n/gergo.ts` resta
  fuori (niente «WebAssembly», «JSON» o «nucleo» nei testi per l'utente se
  non nel comando per esperti di T10).
- I vettori sono scritti a mano e non generati dal codice che verificano;
  lo specchio di T9 è l'unico generato, ed è Rust che lo scrive.
- Le pagine di `docs/` sono in italiano e restano nei limiti di
  `check-doc-size.mjs` (riferimento 550 righe, decisione 180,
  `docs/README.md` 150); una pagina nuova è linkata da `docs/README.md`.
- Non scrivere numeri non misurati.
- Quando cambia `Cargo.toml` o `Cargo.lock` della radice (T1, T10, T13),
  `scripts/check.sh --rapido` controlla tutto il workspace: è lento, è giusto.
- Mai il vault vero (`~/.cache/fub-live/`), mai `~/Progetti/Fub`.

## T1 · Il crate `fub-canvas-core` col modello spostato

Perché: il modello deve vivere in un posto puro che il formato, i comandi e
la WebView usano tutti; oggi è dentro `fub-format-canvas`, che dipende da
`fub-abi` e dal Markdown.
Tocca: `crates/fub-canvas-core/` (nuovo: `Cargo.toml`, `src/lib.rs`,
`src/model.rs`, `src/read.rs`, e vuoti con il solo commento di modulo
`src/js.rs`, `src/source.rs`, `src/patch.rs`, `src/commit.rs`, `src/ops.rs`),
`crates/fub-format-canvas/src/model.rs`, `crates/fub-format-canvas/src/parse.rs`
(solo `parse_canvas`), `crates/fub-format-canvas/src/lib.rs`,
`crates/fub-format-canvas/Cargo.toml`, `Cargo.toml`, `Cargo.lock`,
`crates/fub-abi/tests/dependency_invariant.rs`,
`docs/architecture/overview.md`, `docs/map/repo.md`,
`docs/map/dove-sta-x.md`, `docs/getting-started/repository-tour.md`,
`docs/architecture/components-and-boundaries.md`,
`docs/reference/canvas-format.md` (nuovo), `docs/README.md`,
`scripts/check.sh`, `.github/workflows/ci.yml`.
Non toccare: `crates/fub-format-canvas/src/serialize.rs`,
`json_map.rs`, `rewrite.rs`, `render.rs`, il resto di `parse.rs`
(`parse_document`); le regole di lettura (sono di T3); il client.
Dipende da: nessuno
Cosa fare:
- Spostare in `fub-canvas-core::model` tutto `model.rs` tranne `FORMAT_ID` e
  `SCHEMA_VERSION`, che restano in `fub-format-canvas` (sono del formato);
  `fub-format-canvas/src/model.rs` diventa quelle due costanti più
  `pub use fub_canvas_core::model::*`, e la API pubblica del crate non cambia.
- `fub_canvas_core::read::parse(source) -> Result<Canvas, CanvasError>` con il
  comportamento di oggi (limite di dimensione, vuoto, BOM saltato da sé,
  `validate`); `parse_canvas` lo chiama. Nessuna regola nuova qui.
- `Cargo.toml` del nucleo: `serde`, `serde_json` con `float_roundtrip`,
  `thiserror`, tutti `workspace = true`; membro e voce in
  `[workspace.dependencies]` della radice, accanto a `fub-format-canvas`.
- `the_canvas_core_stands_alone` in `dependency_invariant.rs`, sul modello di
  `the_ink_core_stands_alone`: dipendenze dirette solo quelle tre; lo usano
  solo `fub-format-canvas`, `fub-features` e `fub-canvas-wasm`. Il crate nel
  diagramma `@grafo-dipendenze` di `overview.md` e nelle mappe.
- `cargo check -p fub-canvas-core --target wasm32-unknown-unknown --locked`
  nel giro completo di `scripts/check.sh` (accanto ai controlli `wasip2` di
  scena e inchiostro, saltato se il bersaglio manca) e nel job `invariants`
  di `ci.yml`, dopo `rustup target add wasm32-unknown-unknown`.
- `docs/reference/canvas-format.md`: che cosa è il nucleo, chi lo usa, le
  sezioni «Lettura», «Scrittura», «Parità» ancora da riempire (T3, T5, T7).
Casi limite: `float_roundtrip` cambia la lettura dei decimali in tutto il
grafo (A4): se un test d'istantanea di un altro crate cambia di un'ultima
cifra, si aggiorna e lo si dice; `fub-host` e i test di
`fub-format-canvas` (`canvas_roundtrip.rs`, `linear_parse.rs`) devono
passare senza toccarli.
Fatto quando: `cargo test -p fub-format-canvas` e `cargo test -p fub-abi
--test dependency_invariant` passano; il controllo `wasm32-unknown-unknown`
passa; `fub-canvas-core` non dipende da `fub-abi` (`cargo tree -p
fub-canvas-core -e normal --depth 1`).
Prova: scripts/check.sh --rapido; cargo check -p fub-canvas-core --target
wasm32-unknown-unknown --locked
Stato: [x] fatto

## T2 · Le regole di lettura in TypeScript

Perché: il TypeScript deve leggere come leggerà il nucleo (R1–R10), così i
vettori di T7 hanno un solo esito giusto.
Tocca: `apps/client/src/editors/canvas/model.ts`,
`apps/client/src/editors/canvas/model.test.ts` (nuovo),
`apps/client/src/editors/canvas/source-edit.ts`,
`apps/client/src/editors/canvas/source-edit.test.ts`.
Non toccare: `operation.ts` (la R9 è di T7), `engine.ts` (la R8 non lo
cambia: `dataset.backgroundStyle` prende la stringa così com'è), il Rust.
Dipende da: nessuno
Cosa fare:
- R1: vuoto = BOM facoltativo più spazi JSON, non `trim()`.
- R2: `Number.isSafeInteger` per `x`, `y`, `width`, `height`.
- R3: una variante dello scanner di `source-edit.ts` (oggi `scanJson` lancia
  «duplicate canvas JSON key» a qualunque profondità) che dice dove sta la
  chiave doppia; `parseCanvas` rifiuta una chiave nota doppia su radice,
  scheda o arco e accetta le altre; il riscrittore continua a rifiutare tutto.
- R4: rifiutare le stringhe con surrogati spaiati, chiavi comprese, con
  un'espressione regolare (il `tsconfig` ha `lib` ES2021, quindi niente
  `String.prototype.isWellFormed`).
- R7: `null` sui campi noti facoltativi e su `nodes`/`edges` è assente.
- R8: `backgroundStyle` qualunque stringa.
- Un test per regola in `model.test.ts`, coi casi della prova 2.
Casi limite: un file di solo BOM; `"x": -0`; `"x": 9007199254740992`; una
chiave nota doppia dentro un campo sconosciuto (va bene); un BOM seguito da
CRLF.
Fatto quando: `model.test.ts` ha un test per R1, R2, R3, R4, R7, R8 che
fallisce sul codice di prima e passa dopo; i test della cartella passano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [x] fatto

## T3 · Le regole di lettura in Rust

Perché: le stesse regole di T2, nel nucleo, così Rust e TypeScript aprono gli
stessi file.
Tocca: `crates/fub-canvas-core/src/read.rs`, `src/model.rs` (solo gli
attributi di serde e i deserializzatori dei campi), `crates/fub-canvas-core/tests/read_rules.rs`
(nuovo), `docs/reference/canvas-format.md` (sezione «Lettura»).
Non toccare: `fub-format-canvas` (prende le regole da sé tramite
`parse_canvas`), `js.rs`, `patch.rs`, il client.
Dipende da: T1
Cosa fare:
- R1: vuoto = BOM facoltativo più spazi JSON.
- R2: un deserializzatore per `x`, `y`, `width`, `height` che accetta un
  intero o un `f64` senza parte frazionaria entro ±(2^53−1), e dà un errore
  che nomina il campo.
- R3: con `preserve_order` la mappa dei campi sconosciuti tiene già l'ultimo
  valore nella posizione del primo: un test lo fissa; le chiavi note doppie
  restano un errore di serde.
- R4 e R5: un test per ciascuno (oggi `serde_json` li rifiuta già: si
  controlla e si fissa).
- R7: `nodes` e `edges` `null` come assenti (`deserialize_with`), e un test
  che un campo facoltativo `null` è `None`.
- La sezione «Lettura» della pagina: le regole R1–R5, R7, R8 con un esempio
  ciascuna.
Casi limite: `"x": 1e2`, `"x": 1.5`, `"x": 9007199254740992`, `"x": -0`;
U+0085 da solo; un BOM da solo; `"nodes": null` con `"edges"` assente.
Fatto quando: `tests/read_rules.rs` ha un test per regola con i casi della
prova 2, e passa; `cargo test -p fub-format-canvas` passa ancora.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T4 · Il codificatore come `JSON.stringify`

Perché: quando il nucleo scrive un valore nel sorgente deve scrivere gli
stessi byte che scriverebbe il TypeScript (R6), o i due sorgenti divergono.
Tocca: `crates/fub-canvas-core/src/js.rs`,
`crates/fub-canvas-core/tests/js_encoder.rs` (nuovo).
Non toccare: `read.rs`, `patch.rs`, `source.rs`; la documentazione (la
scrive T5 nella sezione «Scrittura»).
Dipende da: T1
Cosa fare:
- `js_number(f64) -> String` come `Number.prototype.toString`: le cifre più
  corte (`{:e}`), il pareggio esatto deciso verso la cifra pari
  sull'espansione esatta (`format!("{:.1100e}")`, prova 4); forma
  esponenziale da `1e21` in su e sotto `1e-6` (`1e+21`, `1e-7`); `-0` → `0`.
- Ogni numero di un `serde_json::Value` si scrive come lo scriverebbe
  JavaScript dopo averlo letto: un intero oltre 2^53 passa da `f64` (stesso
  arrotondamento di `as f64`).
- `js_string(&str)` con gli escape di `JSON.stringify` (i controlli sotto
  0x20 come `\b \f \n \r \t` o `\u00xx` minuscolo; niente escape per `/`,
  non ASCII, U+2028, U+2029).
- `encode(&Value) -> String` compatto come `JSON.stringify(value)`, con
  l'ordine delle chiavi di JavaScript (prima le chiavi che sembrano indici,
  da `"0"` a `"4294967294"` senza zeri in testa, in ordine crescente, poi le
  altre nell'ordine di inserimento); `encode_pretty` come
  `JSON.stringify(value, null, 2)`.
Casi limite: `5e-324`, `f64::MAX`, `0.1`, `1e21`, `123e-20`; la chiave `"01"`
(non è un indice), `"4294967295"` (non è un indice), `"__proto__"`; una
stringa vuota; un oggetto vuoto (`{}` anche nel rientrato).
Fatto quando: `tests/js_encoder.rs` confronta coi valori scritti a mano di
`JSON.stringify` (presi da Node e incollati nel test, con un commento che lo
dice) almeno 40 numeri, tutti i casi limite e 10 oggetti, e passa.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T5 · Il ritocco del sorgente in Rust

Perché: è il cuore di A2: dato il sorgente, il modello di prima e quello di
dopo, cambiare solo ciò che è cambiato, come `patchCanvasSource`.
Tocca: `crates/fub-canvas-core/src/source.rs`,
`crates/fub-canvas-core/tests/source_edit.rs` (nuovo),
`docs/reference/canvas-format.md` (sezione «Scrittura»).
Non toccare: `apps/client/src/editors/canvas/source-edit.ts` (le correzioni
TypeScript sono di T7), `js.rs` salvo errori trovati (si dice nel rapporto),
`patch.rs`, `ops.rs`.
Dipende da: T3, T4
Cosa fare:
- Il porto di `source-edit.ts`: lo scanner con gli intervalli in byte UTF-8
  (spazi JSON soltanto, non `/\s/`; chiavi doppie a qualunque profondità
  rifiutate), `patch_source(source, before, after) -> Result<String,
  SourceError>`, `node_at(source, byte_offset) -> Option<usize>` (il porto di
  `canvasNodeAt`, ma in byte: la tela ha già l'offset in byte).
- Sorgente vuoto: un testo nuovo rientrato (`encode_pretty`) più `"\n"`, che
  tiene BOM e CRLF.
- Un oggetto con tutti i campi tenuti e nessuno nuovo: si cambiano solo i
  valori; altrimenti si ricompone con prefisso, separatore e suffisso
  trovati, i campi assenti cadono, quelli nuovi vanno in fondo come
  `"chiave":valore` compatti (R10).
- Gli array di schede e archi si accoppiano per id; le voci nuove si scrivono
  compatte, nell'ordine di R10.
- La sezione «Scrittura» della pagina: R6, R7 (il `null` che sparisce), R10.
Casi limite: CRLF; un file a una riga sola; una scheda in mezzo tolta; la
prima e l'ultima tolte (le virgole); `nodes` assente e poi una scheda nuova;
caratteri di quattro byte in un testo; un campo sconosciuto annidato che
cambia; chiavi doppie annidate (rifiuto).
Fatto quando: `tests/source_edit.rs` porta tutti i casi di
`source-edit.test.ts` e `line-endings.test.ts` più i casi limite, con i testi
attesi scritti a mano, e passa; per ognuno il testo di dopo, riletto, dà il
modello di dopo.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T6 · Le toppe al modello

Perché: le toppe di `operation.ts` sono la forma con cui la tela, l'annulla e
(da T8) le operazioni d'intento cambiano una lavagna; devono esistere una
volta, in Rust, con la stessa forma JSON.
Tocca: `crates/fub-canvas-core/src/patch.rs`,
`crates/fub-canvas-core/tests/patch.rs` (nuovo),
`docs/reference/canvas-operations.md` (nuovo), `docs/README.md` (un link).
Non toccare: `operation.ts` (la R9 è di T7), `source.rs`, `js.rs`, `read.rs`.
Dipende da: T1
Cosa fare:
- `CanvasPatch`, con `#[serde(tag = "kind", rename_all = "kebab-case")]` e i
  campi di oggi: `upsert-node {before: nodo|null, after, at?}`,
  `remove-node {before, after: null, at?}`, `upsert-edge {before|null,
  after}`, `remove-edge {before, after: null}`, `reorder {before: [id],
  after: [id]}`; la stessa forma JSON di `CanvasPatch` in TypeScript.
- `draft(canvas, patches) -> Result<Canvas, PatchError>` (il porto di
  `canvasDraft`: un'immagine di prima che non torna è `Stale`, R9 compresa),
  `apply`, `inverse(patches)` (il porto di `inverseCanvasPatches`, con il
  riordino degli `at`).
- `same_value(a, b)` come valori JSON (R9): chiavi in qualunque ordine,
  numeri per valore.
- `docs/reference/canvas-operations.md`: le toppe, i loro errori, l'inversa,
  con un esempio JSON ciascuna; il link in `docs/README.md` fra i contratti.
Casi limite: una toppa che non cambia niente; due toppe sulla stessa scheda;
`at` oltre la fine; togliere una scheda e i suoi archi nello stesso giro;
`reorder` con un id che non c'è; un id ripetuto in `reorder`.
Fatto quando: `tests/patch.rs` porta i casi di `operation.test.ts` più i casi
limite e per ognuno controlla che l'inversa applicata dopo dia il modello di
prima; passa.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T7 · Il commit e i vettori delle toppe

Perché: il nucleo deve fare ciò che fa `commitCanvasPatches` (toppe →
sorgente nuovo verificato), e i vettori devono dire che Rust e TypeScript
danno gli stessi byte.
Tocca: `crates/fub-canvas-core/src/commit.rs`,
`crates/fub-canvas-core/tests/patch_vectors.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-patches/` (nuovo),
`apps/client/src/editors/canvas/vectors.test.ts` (nuovo),
`apps/client/src/editors/canvas/operation.ts`,
`apps/client/src/editors/canvas/operation.test.ts`,
`apps/client/src/editors/canvas/source-edit.ts`,
`docs/reference/canvas-format.md` (sezione «Parità»).
Non toccare: `engine.ts`; `model.ts` (fatto in T2); `ops.rs`.
Dipende da: T2, T5, T6
Cosa fare:
- `Core { open(source), canvas(), source(), commit(&[CanvasPatch]) ->
  Result<Committed, CommitError>, reset(source) }`; `Committed { source,
  inverse, edit }` dove `edit` è il tratto minimo cambiato (inizio e fine in
  byte del vecchio sorgente, testo nuovo), per i comandi. `CommitError`:
  `Stale`, `Invalid` (il modello di dopo non è valido), `Rejected` (il
  ritocco rifiuta il sorgente), `Unstable` (il testo di dopo, riletto, non dà
  il modello di dopo). Un errore lascia `Core` com'era.
- Almeno 30 vettori, uno per file, nella forma di `scene-ops`: `name`,
  `description`, `before` (testo grezzo), `patches`, `expect {outcome,
  text?, undo?, reason?}`, dove `undo` è il testo dopo l'inversa; coprono
  R1–R10, CRLF, BOM, i casi limite di T5 e T6.
- `patch_vectors.rs` li legge come `crates/fub-scene/tests/ops_vectors.rs`;
  `vectors.test.ts` con `import.meta.glob` come quello della scena, contro
  `commitCanvasPatches`.
- TypeScript allineato: `sameValue` secondo R9, l'ordine dei campi di R10 in
  `source-edit.ts` e dove `operation.ts` costruisce una scheda.
- La sezione «Parità»: dove stanno i vettori, come se ne aggiunge uno.
Casi limite: un vettore rifiutato da tutti e due con la stessa ragione; un
vettore dove il TypeScript di oggi dava un altro testo (va scritto nel
rapporto e corretto in TypeScript, non nel vettore).
Fatto quando: la stessa cartella di vettori passa in `cargo test -p
fub-canvas-core --test patch_vectors` e in `vectors.test.ts`; un vettore
cambiato di un byte fa fallire tutti e due.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T8 · Le operazioni d'intento

Perché: un agente e la sessione dal tablet non pensano in toppe con
l'immagine di prima ma in «sposta», «collega», «togli»: `CanvasOp` del passo
12a, compilata in toppe.
Tocca: `crates/fub-canvas-core/src/ops.rs`,
`crates/fub-canvas-core/tests/op_vectors.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-ops/` (nuovo),
`docs/reference/canvas-operations.md` (sezione «Operazioni»).
Non toccare: `patch.rs` salvo errori (si dice nel rapporto), `commit.rs`,
`source.rs`, il client, `docs/README.md`.
Dipende da: T6
Cosa fare:
- `CanvasOp` con `#[serde(tag = "op", rename_all = "snake_case")]`:
  `add_card {node}` (id facoltativo), `move {ids, dx, dy}`, `resize {id,
  width, height}`, `connect {edge}` (id facoltativo), `remove {ids}` (schede
  o archi; gli archi che toccano una scheda tolta vanno via prima), `set {id,
  fields}` (un campo `null` lo toglie), `reorder {ids}`.
- `compile(canvas, ops, seed) -> Result<Compiled, OpError>`, `Compiled
  {patches, created}`; `OpError`: `UnknownNode`, `UnknownEdge`, `DuplicateId`,
  `TooMany`, `Invalid`. Gli id nuovi secondo A10.
- Coordinate e misure saturano a ±(2^53−1); spostare un gruppo non sposta le
  schede dentro (come oggi la tela).
- Almeno 20 vettori sul modello: `before`, `seed?`, `ops`, `expect {outcome,
  after?, created?, error?}`; fra questi `move-with-ink.json` del passo 12a
  (A11) e `agent-board.json` (lavagna vuota, tre schede, due archi) per il
  cancello. Il test controlla anche che l'inversa delle toppe ridia `before`.
- La sezione «Operazioni» della pagina, con un esempio per operazione.
Casi limite: `move` con `ids` vuoto o con un id ripetuto; `remove` di un id
che è sia scheda sia arco (errore); `connect` verso una scheda tolta nello
stesso giro; `set` di `id` o `type` (errore); un seme che genera un id già
preso; 100 001 schede (`TooMany`).
Fatto quando: `cargo test -p fub-canvas-core --test op_vectors` passa su
tutti i vettori.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T9 · Lo specchio a caso fra Rust e TypeScript

Perché: i vettori scritti a mano coprono i casi pensati; lo specchio, come
quello dell'inchiostro, trova quelli che nessuno ha pensato.
Tocca: `crates/fub-canvas-core/tests/ts_mirror.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-mirror.json` (nuovo),
`apps/client/src/editors/canvas/mirror.test.ts` (nuovo),
`docs/map/ownership.md` (una riga, accanto a quella dell'inchiostro); per le
sole divergenze trovate, `crates/fub-canvas-core/src/` e
`apps/client/src/editors/canvas/{model,operation,source-edit}.ts`.
Non toccare: i vettori scritti a mano (se lo specchio trova un caso, lo si
aggiunge come vettore nuovo, non si cambia uno vecchio); `fub-features`;
`engine.ts`.
Dipende da: T7
Cosa fare:
- Come `crates/fub-ink/tests/ts_mirror.rs`: un generatore con seme fisso (un
  generatore congruenziale scritto lì, niente `rand`) fa sorgenti (rientri,
  CRLF, BOM, campi sconosciuti annidati, numeri strani, Unicode), toppe e il
  testo atteso dal nucleo; il file si rigenera con `UPDATE_MIRROR=1 cargo test
  -p fub-canvas-core --test ts_mirror`, e senza la variabile il test fallisce
  se il file è vecchio.
- `mirror.test.ts` legge il file e controlla che `parseCanvas` e
  `commitCanvasPatches` diano lo stesso esito, byte per byte.
- Ogni divergenza: un vettore scritto a mano in `canvas-patches/`, poi la
  correzione dalla parte sbagliata secondo R1–R10.
Casi limite: il file sotto 512 KB; numeri ai bordi (2^53, `5e-324`, pareggi
della prova 4); chiavi che sembrano indici.
Fatto quando: lo specchio con almeno 2000 casi passa in tutti e due; la riga
in `ownership.md` dice chi è la copia autorevole.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
ts_mirror; cd apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T10 · Il componente «Lavagna» e `canvas.apply`

Perché: perché l'host, la CLI e l'MCP cambino una lavagna serve un comando
`canvas.*` in un `CommandProvider` (N2), nel componente `fub.lavagna`.
Tocca: `crates/fub-features/src/lavagna.rs` (nuovo),
`crates/fub-features/src/lavagna/apply.rs` (nuovo),
`crates/fub-features/src/lib.rs`, `crates/fub-features/src/inventory.rs`,
`crates/fub-features/src/componenti.rs`, `crates/fub-features/Cargo.toml`,
`crates/fub-host/Cargo.toml`, `Cargo.lock`,
`crates/fub-features/tests/cargo_features.rs`,
`crates/fub-features/tests/componenti.rs`,
`crates/fub-features/tests/catalogs.rs`,
`docs/reference/canvas-operations.md` (sezione «Comandi»).
Non toccare: `crates/fub-componenti/tests/mappa_del_piano.rs`, il nucleo
(salvo errori, detti nel rapporto), `fub-cli`, il client.
Dipende da: T7, T8; D-6 (facile da disfare: per questo il task non aspetta)
Cosa fare:
- Feature `lavagna = ["dep:fub-canvas-core"]` nel `default`;
  `#[cfg(feature = "lavagna")] pub mod lavagna;`; la voce in `inventory.rs`
  come quella di `draw` (`commands`, `catalog`); in `componenti.rs` la riga
  `fub.lavagna` perde `.senza_bundle()`, prende `.cargo_feature("lavagna")`
  e il commento cambia; `SENZA_FEATURE` di `cargo_features.rs` perde la sua
  voce; `fub-host`: `lavagna` in `official-features` e `lavagna =
  ["fub-features/lavagna"]`.
- `canvas.apply {doc: Document, ops: Text (JSON: un array di CanvasOp),
  base: Text facoltativo, seed: Text facoltativo}`;
  `CommandScope::writing(CommandReach::Document)`, reversibile. Legge il documento, con `base`
  diverso dalla revisione di oggi risponde col conflitto; `Core::open`,
  `compile`, `commit`; un `TextEdit` dal tratto minimo.
- `DryRun`: `CommandEffect::Plan(CommandPlan::of_edits(…))` con il
  `PlannedEdit`; `Apply`:
  `apply_edit`, poi `Undo::of_edits` con l'inversa, e `CommandEffect::Custom
  { ns: "fub.lavagna", payload: {created, revision} }`, come i comandi di
  `commands.rs`.
- Titolo «Applica operazioni alla lavagna» / «Apply operations to the
  whiteboard»; ogni `OpError` e `CommitError` ha la sua chiave in italiano e
  in inglese.
Casi limite: `ops` non JSON o vuoto; un documento che non è `.canvas`; un
documento che non si legge con R1–R10; due `canvas.apply` sulla stessa
revisione (il secondo è in conflitto); `fub-features` senza feature e con la
sola `lavagna`.
Fatto quando: un test in `fub-features` fa `canvas.apply` su una lavagna in
un vault di prova, controlla il testo, poi l'annulla e ritrova i byte di
prima; `ogni_feature_ufficiale_e_una_riga` passa; `cargo check -p
fub-features --no-default-features --features lavagna` passa.
Prova: scripts/check.sh --rapido; cargo check -p fub-features
--no-default-features --features lavagna; cargo test -p fub-cli --test
componenti
Stato: [ ] da fare

## T11 · `canvas.create`

Perché: oggi una lavagna nuova nasce solo dalla shell; il cancello vuole che
la crei anche un agente.
Tocca: `crates/fub-features/src/lavagna/create.rs` (nuovo),
`crates/fub-features/src/lavagna.rs`, `crates/fub-features/tests/catalogs.rs`,
`docs/reference/canvas-operations.md` (sezione «Comandi»).
Non toccare: `crates/fub-features/src/draw/create.rs` (è il modello da
copiare, non da cambiare), `inventory.rs`, `componenti.rs`, `fub-cli`.
Dipende da: T10
Cosa fare:
- `canvas.create {name: Text facoltativo, folder: Text facoltativo}` sul
  modello di `drawing.create`: nome libero della famiglia «Lavagna» /
  «Whiteboard», estensione `.canvas` aggiunta se manca, gli stessi errori di
  conflitto e di nome, `create_document` col sorgente vuoto del nucleo (R6),
  `CommandEffect::Navigate`, annulla che porta il file nel cestino.
- Titolo «Nuova lavagna» / «New whiteboard», descrizione in tutte e due le
  lingue.
Casi limite: nome già preso; nome con `.canvas` già scritto; cartella che non
c'è; nome con caratteri vietati; annulla dopo che il file è stato cambiato.
Fatto quando: un test crea due lavagne senza nome (la seconda prende il nome
libero dopo), legge un sorgente che il nucleo apre, e annulla.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T12 · Gli strumenti MCP `fub_canvas_create` e `fub_canvas_apply`

Perché: è il cancello: un agente crea una lavagna e ci mette schede e archi.
Tocca: `crates/fub-cli/src/mcp/tools.rs`, `crates/fub-cli/src/mcp.rs`
(`INSTRUCTIONS`), `crates/fub-cli/src/cli.rs` (solo il testo d'aiuto di
`mcp`), `crates/fub-cli/tests/mcp.rs`, `docs/reference/mcp-server.md`.
Non toccare: `access.rs` (le funzioni ci sono già), `fub-features`, gli
altri strumenti.
Dipende da: T10, T11
Cosa fare:
- `fub_canvas_create {name?, folder?}`: come `create`: `check_writer`, prova
  di `canvas.create`, `check_write` sul documento nominato, poi `Apply`;
  risponde `{doc, revision}`.
- `fub_canvas_apply {doc, ops, base, apply?}`: `base` obbligatoria come in
  `write`; `check_read` e `check_write` sul documento (non serve tutto il
  vault, A13); `ops` come array JSON o come stringa; senza `apply` il piano,
  con `apply: true` l'esito con `created` e la revisione nuova.
- In `specs()` dopo `fub_create`; il test della lista degli strumenti, la
  tabella di `mcp-server.md`, la sezione «Non ancora» che oggi li annuncia.
- Il test del cancello: crea, applica `agent-board.json` di T8, rilegge, e il
  testo è quello atteso.
Casi limite: radici di scrittura che non coprono la cartella; `base` vecchia
(conflitto, niente scrittura); `ops` non valido (`bad_args`); un documento
che non è una lavagna; server in sola lettura.
Fatto quando: `cargo test -p fub-cli --test mcp` passa col test del cancello
e coi rifiuti dei casi limite.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T13 · La facciata WebAssembly `fub-canvas-wasm`

Perché: la WebView deve usare lo stesso nucleo; serve una porta stretta, con
JSON dentro e fuori e poche chiamate per gesto.
Tocca: `crates/fub-canvas-wasm/` (nuovo: `Cargo.toml`, `src/lib.rs`,
`src/api.rs`, `src/abi.rs`, `tests/api.rs`), `Cargo.toml`, `Cargo.lock`,
`crates/fub-abi/tests/dependency_invariant.rs`,
`docs/architecture/overview.md` (diagramma), `docs/map/repo.md`,
`docs/reference/canvas-operations.md` (sezione «WebAssembly»).
Non toccare: `crates/fub-canvas-core/src/` (salvo errori), il client,
`tools/varco-wasm`, `check-crate-type.mjs` (A5: niente `cdylib` nel
manifesto).
Dipende da: T7, T8; D-1 (costosa da disfare: per questo è in un'ondata dopo i
comandi; se la risposta arriva prima può andare insieme a T12, l'unico con
«Tocca» disgiunti: T10 e T11 toccano `Cargo.lock` o
`canvas-operations.md`)
Cosa fare:
- `src/api.rs`, sicuro e provato in nativo: una tabella di `Core` per
  handle; `open`, `commit`, `compile` (`{ops, seed}`), `reset`, `node_at`,
  `close`, ognuno da JSON UTF-8 a JSON UTF-8, con `{"error": {"code",
  "message"}}` per gli errori.
- `src/abi.rs`, l'unico `unsafe`: `fub_alloc(len)`, `fub_free(ptr, len)`,
  `canvas_open(ptr, len) -> u32` (0 = errore), `canvas_commit(h, ptr, len) ->
  i32`, `canvas_compile`, `canvas_reset`, `canvas_node_at(h, byte) -> i32`,
  `canvas_close(h)`, `result_ptr()`, `result_len()`; un commento `SAFETY` per
  blocco.
- `commit` risponde col tratto cambiato in unità UTF-16 del vecchio
  sorgente (inizio, fine, testo), non col sorgente intero: con 1 MB di file
  copiarlo a ogni gesto costerebbe (prova 1).
- La sezione della pagina: le funzioni, il loro JSON, chi libera la memoria.
Casi limite: un handle chiuso o mai aperto; JSON non UTF-8; un `len` zero;
due lavagne aperte insieme; un panico (con `panic=abort` diventa una
trappola: il chiamante deve rifare l'istanza, scritto nella pagina).
Fatto quando: `cargo test -p fub-canvas-wasm` passa i vettori di T7 e T8
attraverso `api.rs`; il comando di A5 produce un `.wasm` senza import
(`wasm-objdump` se c'è, altrimenti il test di T14), e la sua dimensione è nel
rapporto.
Prova: scripts/check.sh --rapido; CARGO_TARGET_DIR=target/canvas-wasm
CARGO_PROFILE_RELEASE_OPT_LEVEL=s CARGO_PROFILE_RELEASE_LTO=true
CARGO_PROFILE_RELEASE_PANIC=abort CARGO_PROFILE_RELEASE_STRIP=true cargo rustc
-p fub-canvas-wasm --lib --release --target wasm32-unknown-unknown
--crate-type cdylib
Stato: [ ] da fare

## T14 · Il passo nella build di Vite

Perché: la shell deve trovare il `.wasm` fatto dai sorgenti di oggi, in
sviluppo, nei test e nella build.
Tocca: `apps/client/build/canvas-wasm.mjs` (nuovo),
`apps/client/vite.config.ts`, `apps/client/vite.bench.config.ts`,
`apps/client/src/editors/canvas/wasm/core.ts` (nuovo),
`apps/client/src/editors/canvas/wasm/vectors.test.ts` (nuovo),
`.github/workflows/ci.yml`, `.github/workflows/release.yml`,
`.github/workflows/mobile.yml`, `scripts/check.sh`, `scripts/check-scope.mjs`,
`CONTRIBUTING.md`.
Non toccare: `engine.ts` e `surface.ts` (sono di T16),
`crates/fub-app/tauri.conf.json` (T15), i crate.
Dipende da: T13; D-2 (costosa da disfare)
Cosa fare:
- Un plugin di Vite: un modulo virtuale (`virtual:fub-canvas-wasm`) che
  lancia il comando di A5, osserva i sorgenti dei due crate, emette il
  `.wasm` come asset e ne stampa la dimensione; se `cargo` o il bersaglio
  mancano, un errore che dice il comando `rustup target add
  wasm32-unknown-unknown`. In tutte e due le config di Vite.
- `wasm/core.ts`: carica il modulo una volta (`WebAssembly.instantiate`),
  dà `openCore(text)` con `commit`, `compile`, `reset`, `nodeAt`, `close`;
  rifà l'istanza dopo una trappola; rilegge le viste della memoria dopo ogni
  chiamata (la memoria può crescere).
- `wasm/vectors.test.ts`: le cartelle `canvas-patches/` e `canvas-ops/`
  attraverso il `.wasm`, stessi controlli di `vectors.test.ts`.
- CI: Rust e `wasm32-unknown-unknown` in ogni job che lancia `npm test`,
  `npm run build`, il banco visivo o `bench:webview`; il job `changes` segna
  il client anche per `crates/fub-canvas-(core|wasm)/`; `check-scope.mjs`
  idem, e `check.sh` lancia allora `npx vitest run src/editors/canvas`.
- `CONTRIBUTING.md`: il bersaglio da installare.
Casi limite: due build di Vite insieme (stesso `CARGO_TARGET_DIR`: cargo
mette il lucchetto); il server di sviluppo mentre si cambia un `.rs`; un
`.wasm` vecchio in cache; il job `mobile` (stessa build).
Fatto quando: `npm run build` produce il `.wasm` fra gli asset e ne stampa la
dimensione; `wasm/vectors.test.ts` passa; senza il bersaglio, l'errore dice
che cosa installare.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npx
vitest run src/editors/canvas
Stato: [ ] da fare

## T15 · La CSP, la decisione e la misura

Perché: la WebView deve poter compilare WebAssembly, la scelta va scritta, e
i tempi vanno misurati dove girano davvero prima che la tela ci passi.
Tocca: `crates/fub-app/tauri.conf.json` (solo `csp`),
`docs/reference/permissions-and-security.md`, `docs/decisions/0236-…md`
(nuovo, numero secondo A12), `docs/decisions/README.md`,
`apps/client/bench/webview/run.mjs`, `apps/client/bench/webview/budgets.json`,
`docs/misure/lavagna-wasm-AAAA-MM-GG.md` (nuovo), `docs/misure/README.md`.
Non toccare: `crates/fub-services/src/site_isolation.rs` (è la CSP dei siti
pubblicati, un'altra cosa); le altre voci della CSP; il client.
Dipende da: T14; D-3 (costosa da disfare)
Cosa fare:
- `script-src 'self' 'wasm-unsafe-eval'`, nient'altro; la pagina della
  sicurezza dice perché e che cosa non permette.
- La decisione: WebAssembly nella WebView per la lavagna, l'ABI C (D-1), la
  build da Vite (D-2), la CSP; nel registro delle decisioni.
- Uno scenario nuovo in `bench:webview` (accanto a S1–S7, R1, T1, I1): apre
  una lavagna di 50 e una di 2000 schede, misura istanza, `open` e `commit`
  di uno spostamento; i tetti in `budgets.json` dopo la prima misura.
- La pagina di misura: dimensione (grezza e compressa), istanza, `open` e
  `commit` a 50 e 2000 schede, in Node e in WebKitGTK, macchina e versioni;
  la riga nel `README` delle misure, in una tabella nuova «Il nucleo della
  lavagna».
Casi limite: WebKitGTK di una distribuzione vecchia senza
`'wasm-unsafe-eval'` (va scritto se lo si vede); la macchina carica (due giri
uguali, si scrive il rumore); la WebView2 di Windows non misurata qui (si
scrive).
Fatto quando: la shell costruita carica il nucleo senza errori di CSP nella
console; la pagina di misura ha i numeri di Node e di WebKitGTK (dal job
`webview` della CI se in locale non si costruisce l'app).
Prova: scripts/check.sh --rapido; cd apps/client && npm run bench:webview --
--only=<lo scenario nuovo> (con l'app costruita, come dice
`docs/development/webview-measurements.md`)
Stato: [ ] da fare

## T16 · La tela usa il nucleo

Perché: finché la tela scrive col suo TypeScript, Rust e WebView possono
ancora divergere; da qui ogni modifica della tela passa dal nucleo.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/wasm/core.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `model.ts`, `operation.ts`, `source-edit.ts` (si svuotano in
T18); i vettori; `bootstrap.ts`.
Dipende da: T15; D-5 (si vede: il passo d'annulla del testo)
Cosa fare:
- La superficie si monta come `mountVectorSurfaceLazily` di
  `apps/client/src/editors/spatial/lazy.ts`: tiene il testo finché il nucleo
  non è pronto (prima lavagna aperta, poi resta, A6), poi crea la tela.
- `setDoc` e `syncDoc` aprono o fanno `reset`; `#commitLocal` passa le toppe
  a `commit` e usa il tratto cambiato per il testo nuovo e la
  `TextOperation`; l'annulla passa le toppe inverse dallo stesso `commit`;
  `revealSource` usa `nodeAt`; `close` quando la superficie si distrugge.
- Il testo di una scheda (oggi `#commitLocal` a ogni `input`) si registra
  dopo circa 250 ms di pausa, all'uscita dal campo, a Invio e a Esc (D-5).
- Se il nucleo non si carica: l'avviso (chiave nuova nel catalogo, per
  esempio «Questa lavagna non si può disegnare ora: il testo è nella vista
  Sorgente.») e la vista sorgente, come fa il caricamento pigro dei disegni.
- `engine.test.ts`: lo stesso comportamento di prima attraverso il nucleo, e
  il test del cancello che apre il testo di `agent-board.json` e trova le
  stesse schede negli stessi posti.
Casi limite: una modifica esterna mentre si scrive in una scheda; due
superfici sulla stessa lavagna; chiudere la superficie durante il
caricamento; una trappola del nucleo a metà gesto (si rifà l'istanza e si
riapre dal testo della sessione); CRLF (gli offset della sessione sono a
`\n`).
Fatto quando: i test di `src/editors/canvas` passano col nucleo; la tela, nel
banco con l'host finto, apre, sposta, collega, scrive e annulla come prima
(foto del banco invariate, se ci sono); nessuna chiamata al nucleo per tasto
(un test lo conta).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T17 · L'inchiostro in WebAssembly: solo la misura

Perché: il passo 12a vuole sapere se l'inchiostro in WebAssembly regge
`bench:ink` prima di togliere la copia TypeScript; la decisione 0204 vieta di
farlo senza una decisione nuova, quindi qui si misura e basta.
Tocca: `tools/ink-wasm-banco/` (nuovo: `Cargo.toml` con un `[workspace]`
suo, `src/lib.rs`, `Cargo.lock`), `apps/client/src/ink/wasm.bench.ts`
(nuovo), `.gitignore` (il `target/` del banco),
`docs/misure/inchiostro-wasm-AAAA-MM-GG.md` (nuovo), `docs/misure/README.md`.
Non toccare: `crates/fub-ink/` (nemmeno per un `cdylib`), il `Cargo.toml`
della radice, `apps/client/src/ink/` fuori dal file nuovo,
`apps/client/bench/vitest.ink.config.mjs` (prende già `src/ink/**/*.bench.ts`).
Dipende da: D-4; nessun task (può partire con T16)
Cosa fare:
- Un pacchetto fuori dal workspace che dipende da `crates/fub-ink` per
  percorso ed espone con un'interfaccia C le stesse funzioni che misura
  `apps/client/src/ink/pipeline.bench.ts`.
- `wasm.bench.ts`: gli stessi casi di `pipeline.bench.ts`, sul `.wasm`
  costruito a mano (il comando scritto in testa al file); se il `.wasm` manca
  il banco si salta e lo dice.
- La pagina: TypeScript contro WebAssembly, per caso, con la macchina; la
  conclusione dice solo se la condizione del passo 12a è vera, non che cosa
  fare.
Casi limite: la prima chiamata (istanza) contata a parte; il costo di
copiare i punti dentro e fuori; la macchina carica (due giri).
Fatto quando: `npm run bench:ink` stampa le due colonne e la pagina ha i
numeri.
Prova: scripts/check.sh --rapido; cargo build --manifest-path
tools/ink-wasm-banco/Cargo.toml --release --target wasm32-unknown-unknown;
cd apps/client && npm run bench:ink
Stato: [ ] da fare

## T18 · Il TypeScript della lavagna si toglie

Perché: con la parità provata e la tela sul nucleo, la copia TypeScript della
logica è solo un posto in più dove sbagliare.
Tocca: `apps/client/src/editors/canvas/model.ts` (restano i tipi e
`emptyCanvas` se serve al disegno), `operation.ts` (restano i tipi di
`CanvasPatch` e i costruttori di toppe che la tela usa),
`source-edit.ts` (si toglie), `source-edit.test.ts`, `operation.test.ts`,
`model.test.ts`, `line-endings.test.ts`, `vectors.test.ts`, `mirror.test.ts`,
`apps/client/src/__fixtures__/canvas-mirror.json`,
`crates/fub-canvas-core/tests/ts_mirror.rs`, `docs/map/ownership.md`,
`docs/reference/canvas-format.md` (sezione «Parità»).
Non toccare: `wasm/vectors.test.ts` e le cartelle dei vettori (restano, e
sono ora la prova); `engine.ts` salvo gli import; il disegno della tela.
Dipende da: T16; D-8 (togliere test è «Chiede sempre»)
Cosa fare:
- Prima di togliere un test, il rapporto elenca per ognuno il vettore che
  copre i suoi casi; un caso che non c'è diventa un vettore nuovo.
- Tolta la logica: `parseCanvas`, `commitCanvasPatches`, `canvasDraft`,
  `applyCanvasPatches`, `inverseCanvasPatches`, `patchCanvasSource`,
  `canvasNodeAt`, `sameCanvasModel`. Lo specchio non ha più una seconda
  copia: si toglie, e `ownership.md` lo dice.
Casi limite: `editors/core/bootstrap.ts` e `editors/rich/surface.ts`
importano da `surface.ts` e `engine.ts` della lavagna, che restano: non
cambiano; un tipo di `model.ts` usato dal disegno resta; `npm run typecheck`
deve restare verde.
Fatto quando: `grep -rn "patchCanvasSource\|commitCanvasPatches\|parseCanvas"
apps/client/src` non trova più definizioni; `wasm/vectors.test.ts` e i test
della tela passano.
Prova: scripts/check.sh --rapido; cd apps/client && npm run typecheck && npx
vitest run src/editors/canvas
Stato: [ ] da fare

## Non verificato stanotte

- I tempi di WebAssembly in WebKitGTK e in WebView2 (solo Node, prova 1): li
  misura T15.
- La dimensione del nucleo intero (operazioni, ritocco, `float_roundtrip`):
  stima 200–300 KB grezzi, la stampa T14.
- Che cosa fa Obsidian con `1.0`, i campi `null` e un file vuoto.
- Il confronto con `bench:ink` (T17).
- Il comportamento esatto di Rust su `"nodes": null` e `"-0"`: dedotto dal
  codice; T3 lo fissa coi test.
- Se uno scenario di `bench:webview` può ospitare la misura senza toccare
  il driver.
