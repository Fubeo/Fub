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
dell'inchiostro (D-4 (a): T17 l'ha misurata, e resta in TypeScript come vuole
la decisione 0204; si riconsidera solo se cambia il modo in cui i dati passano
fra la WebView e WebAssembly); aprire le lavagne con valori sconosciuti nei
campi noti (D-9); unificare `json_map.rs` di
`fub-format-canvas` col nucleo; un `ParamKind` JSON o una superficie «solo per
gli agenti» nell'ABI dei comandi; la pagina di prodotto `product/lavagna.md`;
i sottocomandi `fub canvas …` della CLI; bottoni nuovi nell'interfaccia
oltre ai due comandi della tavolozza.
Assunzioni: A1–A13 e il contratto R1–R10 qui sotto, decisi dal pianificatore
il 2026-11-02 di notte; lo stesso giorno l'utente ha risposto a D-1…D-8 e a
merge-n3n4 (le righe «Risposta» in «Domande per l'utente»). Le risposte
confermano A1–A13, cambiano R7 e aggiungono R11 (D-7 (c)), e portano A14–A18,
che l'orchestratore fa vedere all'utente prima di far partire T16.
Ondate: T1 T2 | T3 T4 T6 | T5 T8 | T7 | T9 T10 | T11 | T12 | T13 | T14 | T15 | T16 T17 | T19 | T18 | T20 T21 | T22 | T23
Prototipo: nessuno. N3 non ha grafica nuova: gli avvisi nuovi (T16, T22)
usano il posto dell'avviso che la tela ha già nella sua barra
(`canvas-intake-error`) e la sola lettura che c'è già (`setReadOnly`). Testi
visibili nuovi: i titoli e le descrizioni dei due comandi (T10, T11), la riga
«Lavagna» in Impostazioni → Componenti (T10), i messaggi d'errore dei comandi
(T10, T11), l'avviso se il nucleo non si carica e quello di un testo di
scheda oltre 1 MiB (T16), e l'avviso di una lavagna che si può guardare ma
non cambiare (T22).

## Modifiche

- 2026-11-02 · Le risposte dell'utente a D-1…D-8 e a merge-n3n4. T13–T16 e
  T18 diventano pronti e si allargano: il ponte provato in andata e ritorno
  (T13, T14), il test che tiene chiusa la CSP (T15), il testo della scheda
  registrato a pause con Esc che registra (T16), l'elenco dei test tolti col
  vettore che li sostituisce (T18). Task nuovi: T19 (il testo in corso nelle
  bozze, D-5 (c)), T20–T22 (conservare ciò che Fub non tocca, D-7 (c)), T23
  (la CI completa e la revisione, merge-n3n4 (b)). Cambiano R7 e il cancello
  (righe nuove, e lo specchio passa al `.wasm`), si aggiungono R11, A14–A18
  e le domande D-9 e D-10, che non bloccano · perché l'utente ha risposto ·
  task toccati: T13, T14, T15, T16, T18, T19–T23; da rivedere T5, T6, T7,
  T8, T9.

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
L'utente ha risposto il 2026-11-02 a D-1…D-8 (la riga «Risposta» sotto
ognuna) e a merge-n3n4 (in fondo). D-9 e D-10 sono nuove, nate dalle
risposte, e non bloccano: il piano procede con la (a).

- D-1 · Come parla la WebView col nucleo (T13, T14). (a) Consigliata:
  un'interfaccia C scritta a mano, JSON dentro e fuori, nessuna libreria
  nuova: la prova 1 dà 56 KB compressi e nessun import. (b) `wasm-bindgen`
  come nel passo 12a: più comodo da scrivere, ma è una dipendenza nuova, più
  `wasm-bindgen-cli` della stessa versione in ogni macchina e job che
  costruisce il client. Cambiare idea dopo T13 vuol dire riscrivere T13 e il
  caricatore di T14.
  Risposta (2026-11-02): (a) — il ponte è scritto a mano, nessuna libreria
  nuova, e T13 e T14 lo provano in andata e ritorno anche nei casi strani.
- D-2 · Da dove viene il file `.wasm` (T14). (a) Consigliata: lo compila
  Vite dai sorgenti a ogni build; serve Rust col bersaglio
  `wasm32-unknown-unknown` dovunque si lanci `npm` (in locale e in ogni job
  della CI che costruisce o prova il client). (b) Un `.wasm` committato e una
  guardia che lo confronta coi sorgenti: niente Rust per chi lavora solo sul
  client, ma un binario nel repo. (c) Uno script separato prima di Vite.
  Risposta (2026-11-02): (a) — Vite compila il `.wasm` dai sorgenti a ogni
  build, quindi Rust e il bersaglio servono dovunque si costruisca il client.
- D-3 · Sicurezza della WebView (T15, T16). (a) Consigliata: aggiungere solo
  `'wasm-unsafe-eval'` a `script-src` nella CSP di
  `crates/fub-app/tauri.conf.json` (permette di compilare WebAssembly, non di
  eseguire testo come JavaScript). (b) Niente WebAssembly nella WebView: N3 si
  ferma a T12 (comandi e MCP sì), la tela resta in TypeScript e le due copie
  restano tenute uguali dai vettori.
  Risposta (2026-11-02): (a) — la CSP aggiunge solo `'wasm-unsafe-eval'` a
  `script-src`, e un test di T15 fallisce se si apre qualcosa di più.
- D-4 · L'inchiostro (T17). (a) Consigliata: in N3 solo la misura in
  `bench:ink`; la copia TypeScript resta, come vuole la decisione 0204 (niente
  WebAssembly a ogni evento del puntatore). (b) Portarlo ora, se la misura
  regge: va contro 0204 e va deciso con una decisione nuova.
  Risposta (2026-11-02): (a) — l'inchiostro resta in TypeScript; T17 l'ha
  misurato e basta.
- D-5 · Il testo di una scheda (T16). Oggi ogni tasto premuto è una modifica
  salvata e un passo d'annulla. (a) Consigliata: la modifica si registra dopo
  una pausa di circa 250 ms, all'uscita dal campo, a Invio e a Esc; un
  «annulla» toglie una frase, non una lettera. (b) Solo all'uscita dal campo.
  In tutti e due i casi niente chiamata al nucleo per ogni tasto
  (`CLAUDE.md`: «No IPC or WASM per keystroke»).
  Risposta (2026-11-02): (c) — come (a), e in più il testo ancora nel campo
  finisce nelle bozze di recupero (T16 e il task nuovo T19). La descrizione
  di «oggi» qui sopra non era esatta: l'annulla della tela toglie già tutta
  la modifica di un campo in un passo, non una lettera, ed Esc oggi butta
  via ciò che si è scritto nel campo (vedi D-10).
- D-6 · Che cosa vede l'utente (T10, T11). (a) Consigliata: un componente
  «Lavagna» nuovo, con la sua riga in Impostazioni → Componenti (spegnerlo
  toglie i due comandi), e nella tavolozza «Nuova lavagna» e «Applica
  operazioni alla lavagna» (il secondo chiede un testo JSON: la tavolozza
  mostra tutti i comandi, e nasconderne uno vorrebbe un cambio dell'ABI). (b)
  I due comandi dentro il componente dei comandi delle note, senza riga
  nuova. Facile da cambiare dopo: si sposta un modulo.
  Risposta (2026-11-02): (a) — la riga «Lavagna» tutta sua, com'è già
  (T10).
- D-7 · Che cosa si apre e come si riscrive (T2, T3). (a) Consigliata: le
  regole R1–R10 così come sono scritte: si aprono anche coordinate `1.0` o
  `1e2` e campi `null`, un file con solo il BOM è una lavagna vuota, i `null`
  dei campi noti spariscono quando Fub riscrive quella scheda; restano
  rifiutati decimali veri, chiavi note doppie, surrogati spaiati. (b) Più
  severe (rifiutare `1.0` e i `null`). Facile da cambiare dopo: è codice di
  lettura, e i vettori dicono che cosa cambia.
  Risposta (2026-11-02): (c) — si apre come in (a), e quando riscrive Fub
  conserva esattamente ciò che non tocca, `null` dei campi noti compresi
  (R7 cambia e si aggiunge R11; i task nuovi T20, T21, T22).
- D-8 · Togliere il TypeScript (T18). (a) Consigliata: dopo la parità si
  tolgono `parseCanvas`, le toppe e il riscrittore TypeScript, e con loro i
  loro test, i cui casi devono essere prima nei vettori (togliere un test è
  una voce di «Chiede sempre»). (b) Tenere la copia TypeScript come seconda
  via, tenuta uguale dallo specchio.
  Risposta (2026-11-02): (a) — la copia TypeScript si toglie, ma solo dopo
  che ogni caso dei suoi test gira sui vettori comuni e passa (l'elenco è in
  T18).
- merge-n3n4 · Quando N3 (e poi N4) entra in main (domanda generale, fatta
  dal coordinatore per N3 e N4). (a) Adesso, con le parti fatte. (b) Solo
  quando N3 è finito; intanto N6 va avanti sopra i rami.
  Risposta (2026-11-02): (b) — N3 entra in main solo quando tutti i suoi
  task sono fatti, dopo la CI completa e una revisione riga per riga (T23);
  N4 entra dopo, e N6 intanto va avanti sopra i rami di N3 e N4.
- D-9 · Le lavagne con valori che Fub non conosce in un campo noto (nuova,
  nata da D-7 (c)). Una scheda di un tipo che non è `text`, `file`, `link` o
  `group` (per esempio di un plugin di Obsidian), un lato o una punta d'arco
  sconosciuti, o un colore che non è da `"1"` a `"6"` né `#` con 3, 4, 6 o 8
  cifre: oggi un file così non si apre sulla tela, né in Rust né in
  TypeScript, e i comandi lo rifiutano. (a) Consigliata: un piano suo dopo N3,
  che le apre e disegna quelle schede come «scheda che Fub non conosce», che
  si sposta e si conserva byte per byte ma non si cambia: è grafica nuova
  (prima un prototipo) e cambia il modello del nucleo, il formato che
  leggono i comandi e l'MCP, quindi non va infilata in N3. (b) Dentro N3: un
  prototipo in `PLAN-ui/` e due task nuovi prima di T23. (c) Come oggi, per
  sempre. Non blocca niente: con (a) N3 non le tocca.
  Risposta (2026-11-03): (b) — dentro N3: un prototipo in `PLAN-ui/` e due
  task prima di T23, scritti dal pianificatore; N3 entra in main con le
  lavagne che hanno valori sconosciuti in un campo noto aperte e conservate
  byte per byte.
- D-10 · Esc in una scheda (nuova: la descrizione di D-5 non era esatta).
  Oggi Esc butta via ciò che si è scritto nel campo da quando si è aperto;
  la risposta a D-5 dice che Esc registra. (a) Consigliata: Esc registra e
  chiude, come dice la risposta: un Esc premuto per sbaglio non perde
  niente, e per tornare indietro c'è «Annulla», una frase alla volta. (b)
  Esc butta via ciò che si è scritto da quando il campo si è aperto, come
  oggi, anche le frasi già registrate. Non blocca: T16 fa (a), e cambiare
  dopo è una funzione di T16 e il suo test.
  Risposta (2026-11-03): (a) — Esc registra e chiude; per tornare indietro
  c'è «Annulla» (A14, T16).

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

Dalle risposte del 2026-11-02 (l'orchestratore le fa vedere all'utente prima
di T16; A14 è la domanda D-10):

- A14 · **Esc in una scheda registra e chiude** (D-5, D-10 (a)). Oggi Esc
  butta via ciò che si è scritto nel campo.
- A15 · **Invio.** In una scheda di testo Invio va a capo come oggi e
  registra ciò che c'è fin lì; Ctrl+Invio (Cmd+Invio sul Mac) registra e
  chiude, come oggi conferma. Negli altri campi (link, file, nome del gruppo)
  Invio registra e chiude, come oggi.
- A16 · **Un passo d'annulla per registrazione** (D-5): la pausa di circa
  250 ms, l'uscita dal campo, Invio, Esc. Oggi il passo è uno solo per tutta
  la modifica del campo. Con il campo aperto Ctrl+Z resta quello del campo
  (del browser), come oggi.
- A17 · **Quanto protegge la bozza** (D-5 (c)). Una chiusura ordinata (la
  finestra, la scheda, il riquadro, un altro documento nello stesso
  riquadro) registra il testo in sospeso prima: non si perde niente. Una
  chiusura di colpo (Fub ucciso, la corrente che manca) perde al più ciò che
  si è scritto nell'ultimo secondo (`DRAFT_MS`): scrivere sul disco a ogni
  tasto vorrebbe una chiamata all'host per tasto, che `CLAUDE.md` vieta. Per
  questo il ritardo della bozza smette di ripartire a ogni modifica e
  diventa una cadenza, per tutti i documenti, note comprese (T19): oggi chi
  scrive senza fermarsi non ha nessuna bozza sul disco finché non si ferma.
- A18 · **Una lavagna che Fub non può riscrivere senza perdere niente** (una
  chiave doppia, che il riscrittore rifiuta per R3) si apre in sola lettura e
  lo dice (T22). Oggi si apre, e ogni gesto torna indietro senza un perché.
  Risposta (2026-11-03): A14–A18 approvate dall'utente il 2026-11-03 («ci
  sto»): T16 parte quando tocca a lui.

## Il contratto di lettura e scrittura (R1–R11)

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
  `"edges": null`, vogliono dire «assente». Cambiata da D-7 (c), la fa T20:
  il `null` resta dov'è, anche quando Fub riscrive quella scheda, finché quel
  campo non prende un valore (allora il valore va al posto del `null`). Prima
  diceva «quando Fub riscrive quella scheda, il `null` sparisce», ed è ciò
  che il codice fa fino a T20 (il vettore 18).
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
- R11 · **Ciò che Fub non tocca resta byte per byte** (D-7 (c); T20, T21).
  La grafia di ogni valore che non cambia (`1.0`, `1e2`, `-0`, gli escape di
  una stringa), gli spazi, l'ordine delle chiavi, delle schede e degli archi,
  i campi sconosciuti e i `null` restano com'erano, anche dentro una scheda
  che si ricompone. Un `nodes` o un `edges` assente non si aggiunge finché
  resta vuoto. Un arco tolto e rimesso dall'annulla torna al suo posto, come
  una scheda. L'annulla della tela torna ai byte di prima, se il testo non è
  cambiato da un'altra parte nel frattempo. Ciò che Fub cambia si scrive
  secondo R6 e R10.

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

Trovate rileggendo il codice dopo le risposte del 2026-11-02 (vince il
codice; ognuna ha il suo task):

- D-5 descriveva male la tela: `#beginCardEdit` di `engine.ts` manda già il
  testo alla sessione a ogni `input`, ma l'annulla raggruppa tutta la
  modifica del campo in un passo solo; Esc (`finish(false)`) rimette il
  testo di prima e non lascia un passo d'annulla (A14, A16, D-10).
- Salvataggio e bozza sono ritardi che ripartono a ogni modifica
  (`SAVE_MS` 400 ms, `DRAFT_MS` 1 s in `state/document-session.ts`): chi
  scrive senza fermarsi non ha niente sul disco, né file né bozza, finché
  non si ferma. Vale per ogni documento (A17, T19).
- Le bozze di recupero coprono già il `.canvas` (sono per documento:
  `saveDraft` → `fub-kernel`, `.fub/drafts/`), ma solo il testo della
  sessione: dopo T16 il testo ancora nel campo non c'è (T19).
- Il `null` di un campo noto sparisce quando la scheda si ricompone
  (vettore 18), e una radice senza `edges` che si ricompone riceve
  `"edges":[]` (vettore 11): D-7 (c) vuole il contrario (T20).
- Le toppe degli archi non hanno `at`: l'annulla di un arco tolto lo rimette
  in fondo (vettore 16), e `tests/op_vectors.rs` confronta gli archi senza
  guardare l'ordine (T20).
- L'annulla della tela applica le toppe inverse e non torna ai byte di prima
  (vettori 12, 14, 22: una scheda rientrata torna compatta, `1e2` torna
  `100`); l'annulla dei comandi (`Undo::of_edits` in `lavagna/apply.rs`)
  invece sì (T21).
- Una lavagna con una chiave sconosciuta doppia si apre (R3), ma il
  riscrittore la rifiuta e ogni gesto torna indietro senza un avviso (T22).
- Un tipo di scheda, un lato, una punta o un colore sconosciuti fanno
  rifiutare tutto il file, in Rust e in TypeScript (D-9).
- Il cancello chiedeva lo specchio di T9, e T18 lo toglieva: ora T18 lo
  tiene contro il `.wasm`, dove la build a 32 bit può ancora divergere.
- I vettori delle toppe partono sempre da un testo che si apre: le regole di
  lettura non hanno vettori comuni, e i loro casi sono solo nei test
  TypeScript che T18 toglie (T18 aggiunge `canvas-read/`).

## Cancello di N3

| Fatto quando | Prova | Task |
|---|---|---|
| tutti i vettori passano nel nucleo nativo e nel `.wasm` (fino a T18 anche nel TypeScript) | `cargo test -p fub-canvas-core`; `cd apps/client && npx vitest run src/editors/canvas` (gli stessi file per tutti) | T7, T8, T14, T18 |
| lo specchio a caso non trova divergenze: fino a T18 fra Rust e TypeScript, poi fra il nucleo nativo e il `.wasm` | `cargo test -p fub-canvas-core --test ts_mirror` e `mirror.test.ts` (da T18 `wasm/mirror.test.ts`) | T9, T18 |
| il ponte scritto a mano fa andare e tornare i dati in tutti i casi, anche quelli strani, e libera la memoria | `cargo test -p fub-canvas-wasm` (`tests/api.rs`, `tests/abi.rs`); `cd apps/client && npx vitest run src/editors/canvas/wasm` | T13, T14 |
| un agente crea una lavagna, aggiunge schede e archi, e la shell la mostra uguale | `cargo test -p fub-cli --test mcp` (il testo scritto è quello del vettore `canvas-ops/agent-board.json`); il test della tela apre lo stesso testo e disegna le stesse schede negli stessi posti | T12, T16 |
| la tela usa il nucleo, e il TypeScript della lavagna si toglie | `engine.ts` non importa più `model.ts`/`operation.ts`/`source-edit.ts` per leggere o scrivere; quei file non hanno più la logica | T16, T18 |
| ogni test TypeScript tolto ha il vettore che fa i suoi casi, e quel vettore passa | la tabella «test tolti → vettore» nel rapporto di T18, controllata con `grep` sui file dei vettori, e `npx vitest run src/editors/canvas` | T18 |
| la CSP permette di compilare WebAssembly e niente di più: eseguire testo come codice resta vietato | `cargo test -p fub-app --test platform_configs` (fallisce con `'unsafe-eval'` dovunque o con `'wasm-unsafe-eval'` fuori da `script-src`, per ogni piattaforma) | T15 |
| la WebView carica il nucleo e i tempi reggono | la pagina in `docs/misure/` con dimensione, istanza e un commit a 50 e 2000 schede in Node e in WebKitGTK | T15 |
| il testo che si sta scrivendo in una scheda è nelle bozze di recupero: una chiusura ordinata non perde niente, una di colpo al più l'ultimo secondo | `cd apps/client && npx vitest run src/state src/editors/canvas` e il test della shell che chiude la finestra durante la pausa | T16, T19 |
| Fub riscrive una lavagna di un altro programma cambiando solo ciò che tocca, e l'annulla della tela torna ai byte di prima | i vettori nuovi di T20 in Rust e nel `.wasm`; il test di `canvas.apply` su una lavagna scritta come Obsidian; i test d'annulla di `engine.test.ts` | T20, T21 |
| una lavagna che Fub non può riscrivere senza perdere niente si apre in sola lettura e lo dice | `engine.test.ts` con un sorgente a chiave doppia | T22 |
| l'inchiostro in WebAssembly è misurato | `npm run bench:ink`, la pagina in `docs/misure/`; D-4 (a): l'inchiostro resta in TypeScript | T17 |
| tutti i task sono fatti; la CI completa passa sulla PR non più in bozza (Linux, Windows, macOS, i banchi); la revisione riga per riga è fatta e ciò che ha trovato è corretto; l'utente dice sì al merge. N3 entra in main prima di N4 (merge-n3n4 (b)) | la PR #297 coi controlli verdi e il resoconto della revisione nel rapporto di T23 | T23 |

## Regole che valgono per ogni task

- Vince il codice: se un percorso o una funzione non è come scritto qui, il
  coder lo dice nel suo rapporto e segue il codice.
- Nessuna dipendenza esterna nuova (né `wasm-bindgen`, né `ryu-js`, né
  altro): D-1 (a).
- Il nucleo non va in panico su un input: ogni errore è un `Result` con un
  enum di `thiserror`; niente `unwrap` o `expect` nei sorgenti di
  `fub-canvas-core` fuori dai test. `unsafe` solo in
  `crates/fub-canvas-wasm/src/abi.rs` e nel suo test
  `crates/fub-canvas-wasm/tests/abi.rs`, con un commento `SAFETY` per blocco.
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
  Da rivedere: T20 lo cambia (D-7 (c)): il `null` di un campo noto resta, e un
  `nodes` o `edges` assente non si aggiunge finché resta vuoto.

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
  Da rivedere: T20 lo cambia (D-7 (c)): anche le toppe degli archi hanno `at`,
  e l'inversa rimette l'arco al suo posto.

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
Stato: [x] fatto
  Da rivedere: T20 lo cambia (D-7 (c)): i vettori 11 e 18 cambiano testo, e
  se ne aggiungono altri.

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
  Da rivedere: T20 lo cambia (D-7 (c)): `remove` e l'inversa tengono il posto
  degli archi, e `tests/op_vectors.rs` li confronta in ordine.

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
Stato: [x] fatto
  Da rivedere: T18 lo cambia (D-8 (a)): lo specchio resta, ma contro il
  `.wasm` invece che contro il TypeScript.

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
Stato: [x] fatto

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
Stato: [x] fatto

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
Stato: [x] fatto

## T13 · La facciata WebAssembly `fub-canvas-wasm`

Perché: la WebView deve usare lo stesso nucleo; serve una porta stretta, con
JSON dentro e fuori e poche chiamate per gesto. D-1 (a): il ponte è scritto a
mano, e all'utente è promesso che lo provano test di andata e ritorno anche
nei casi strani.
Tocca: `crates/fub-canvas-wasm/` (nuovo: `Cargo.toml`, `src/lib.rs`,
`src/api.rs`, `src/abi.rs`, `tests/api.rs`, `tests/abi.rs`), `Cargo.toml`,
`Cargo.lock`, `crates/fub-canvas-core/src/commit.rs` (solo `Core::preview`),
`crates/fub-canvas-core/tests/patch_vectors.rs` (i controlli di `preview`),
`crates/fub-abi/tests/dependency_invariant.rs`,
`docs/architecture/overview.md` (diagramma), `docs/map/repo.md`,
`docs/reference/canvas-operations.md` (sezione «WebAssembly»).
Non toccare: il resto di `crates/fub-canvas-core/src/` (salvo errori, che si
dicono nel rapporto), il client, `tools/varco-wasm`, `check-crate-type.mjs`
(A5: niente `cdylib` nel manifesto).
Dipende da: T7, T8; D-1 (a), risposta del 2026-11-02
Cosa fare:
- `Core::preview(&self, patches) -> Result<String, CommitError>` in
  `commit.rs`: il testo che darebbe `commit`, senza cambiare `Core`. Serve
  alle bozze di T19; `patch_vectors.rs` controlla che per ogni vettore
  applicato `preview` dia il testo di `commit` e lasci `Core` com'era, e che
  per ogni rifiutato dia lo stesso errore.
- `src/api.rs`, sicuro e provato in nativo: una tabella di `Core` per
  handle; `open`, `commit`, `preview`, `compile` (`{ops, seed}`), `reset`,
  `node_at`, `close`, ognuno da JSON UTF-8 a JSON UTF-8, con `{"error":
  {"code", "message"}}` per gli errori. Gli handle crescono e non si
  riusano: un handle chiuso non arriva mai alla lavagna di un altro.
- `src/abi.rs`, l'unico `unsafe`: `fub_alloc(len)` (0 se `len` passa il
  limite d'ingresso o la memoria non basta: `try_reserve_exact`, mai un
  panico), `fub_free(ptr, len)`, `canvas_open(ptr, len) -> u32` (0 =
  errore), `canvas_commit(h, ptr, len) -> i32`, `canvas_preview`,
  `canvas_compile`, `canvas_reset`, `canvas_node_at(h, byte) -> i32`,
  `canvas_close(h)`, `result_ptr()`, `result_len()`; un commento `SAFETY`
  per blocco. Il risultato vale fino alla chiamata dopo.
- `commit` risponde col tratto cambiato in unità UTF-16 del vecchio
  sorgente (inizio, fine, testo), non col sorgente intero: con 1 MB di file
  copiarlo a ogni gesto costerebbe (prova 1). `preview` risponde col testo
  intero, perché la bozza lo vuole intero e la si scrive al più una volta al
  secondo.
- Il limite d'ingresso (almeno `MAX_SOURCE_BYTES`, perché una toppa porta
  anche una scheda con 1 MiB di testo) è una costante scritta nella pagina.
- La sezione della pagina: le funzioni, il loro JSON, chi alloca e chi
  libera la memoria, quanto vive il risultato, i limiti, che cosa fa una
  trappola. Non è un contratto pubblico: lo usano solo `wasm/core.ts` e il
  `.wasm` della stessa build, e la pagina lo dice.
Casi limite: un handle chiuso, mai aperto, 0 o `u32::MAX`; byte non UTF-8
(`0xFF`, una sequenza di quattro byte tronca, un surrogato codificato `ED A0
80`); JSON non valido, o valido ma della forma sbagliata; un `len` zero, con
o senza puntatore nullo; due lavagne aperte insieme, e una chiusa mentre
l'altra lavora; un risultato vuoto e uno più grande di una pagina di memoria
(64 KiB); un panico (con `panic=abort` diventa una trappola: il chiamante
deve rifare l'istanza, scritto nella pagina).
Fatto quando: `cargo test -p fub-canvas-wasm` passa e prova, attraverso
`api.rs` e attraverso le funzioni `extern "C"` di `abi.rs` chiamate in
nativo (`tests/abi.rs`):
- andata e ritorno: ogni vettore di `canvas-patches/` e `canvas-ops/` dà,
  per le due vie, il testo, il tratto e l'errore attesi; il
  tratto UTF-16 applicato al vecchio sorgente (come stringa UTF-16) dà il
  sorgente nuovo, con caratteri ASCII, di due, tre e quattro byte, BOM e
  CRLF;
- input non valido: ogni caso limite qui sopra, salvo il panico voluto,
  risponde con un errore JSON, e nessuno va in panico;
- dimensioni: un sorgente di 16 MiB si apre e si cambia, uno di un byte in
  più è un errore `limit`, un `fub_alloc` oltre il limite dà 0;
- memoria liberata: con un allocatore che conta (il `#[global_allocator]` di
  `tests/abi.rs`), dopo 10 000 giri di `open`, `commit`, `preview` e `close`
  la memoria viva torna quella dopo il primo giro;
- il comando di A5 produce un `.wasm` senza import (`wasm-objdump` se c'è,
  altrimenti il test di T14), e la sua dimensione è nel rapporto.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-wasm;
CARGO_TARGET_DIR=target/canvas-wasm CARGO_PROFILE_RELEASE_OPT_LEVEL=s
CARGO_PROFILE_RELEASE_LTO=true CARGO_PROFILE_RELEASE_PANIC=abort
CARGO_PROFILE_RELEASE_STRIP=true cargo rustc -p fub-canvas-wasm --lib
--release --target wasm32-unknown-unknown --crate-type cdylib
Stato: [x] fatto

## T14 · Il passo nella build di Vite

Perché: la shell deve trovare il `.wasm` fatto dai sorgenti di adesso, in
sviluppo, nei test e nella build. D-2 (a): lo compila Vite a ogni build,
così un `.wasm` vecchio non può esistere.
Tocca: `apps/client/build/canvas-wasm.mjs` (nuovo),
`apps/client/vite.config.ts`, `apps/client/vite.bench.config.ts`,
`apps/client/src/editors/canvas/wasm/core.ts` (nuovo),
`apps/client/src/editors/canvas/wasm/core.test.ts` (nuovo),
`apps/client/src/editors/canvas/wasm/vectors.test.ts` (nuovo),
`.github/workflows/ci.yml`, `.github/workflows/release.yml`,
`.github/workflows/mobile.yml`, `scripts/check.sh`, `scripts/check-scope.mjs`,
`CONTRIBUTING.md`, `CLAUDE.md` (solo la riga dei bersagli).
Non toccare: `engine.ts` e `surface.ts` (sono di T16),
`crates/fub-app/tauri.conf.json` (T15), i crate.
Dipende da: T13; D-2 (a), risposta del 2026-11-02
Cosa fare:
- Un plugin di Vite: un modulo virtuale (`virtual:fub-canvas-wasm`) che
  lancia il comando di A5, osserva i sorgenti dei due crate, emette il
  `.wasm` come asset e ne stampa la dimensione; se `cargo` o il bersaglio
  mancano, un errore che dice il comando `rustup target add
  wasm32-unknown-unknown`. In tutte e due le config di Vite.
- `wasm/core.ts`: carica il modulo una volta (`WebAssembly.instantiate`),
  dà `openCore(text)` con `commit`, `preview`, `compile`, `reset`,
  `nodeAt`, `close`; rifà l'istanza dopo una trappola; rilegge le viste
  della memoria dopo ogni chiamata (la memoria può crescere); libera con
  `fub_free` ogni buffer che alloca, anche quando la chiamata fallisce.
- Un testo con un surrogato spaiato non va al nucleo: `TextEncoder` lo
  cambierebbe in U+FFFD senza dirlo, e i tratti non tornerebbero più col
  testo della sessione. `core.ts` lo controlla (`isWellFormed`, o una
  regola equivalente dove manca) e risponde con un errore.
- `wasm/vectors.test.ts`: le cartelle `canvas-patches/` e `canvas-ops/`
  attraverso il `.wasm`, stessi controlli di `vectors.test.ts`.
- CI: Rust e `wasm32-unknown-unknown` in ogni job che lancia `npm test`,
  `npm run build`, il banco visivo o `bench:webview`; il job `changes` segna
  il client anche per `crates/fub-canvas-(core|wasm)/`; `check-scope.mjs`
  idem, e `check.sh` lancia allora `npx vitest run src/editors/canvas`.
- `CONTRIBUTING.md` e la riga dei bersagli di `CLAUDE.md` (oggi solo
  `wasm32-wasip2`): il bersaglio `wasm32-unknown-unknown` da installare per
  il client.
Casi limite: due build di Vite insieme (stesso `CARGO_TARGET_DIR`: cargo
mette il lucchetto); il server di sviluppo mentre si cambia un `.rs`; un
`.wasm` vecchio in cache; il job `mobile` (stessa build); un testo vuoto, uno
di soli caratteri di quattro byte, uno con un surrogato spaiato; una
chiamata dopo `close`.
Fatto quando: `npm run build` produce il `.wasm` fra gli asset e ne stampa la
dimensione; due build dagli stessi sorgenti danno lo stesso `.wasm` (stesso
hash), e un `.rs` cambiato ne dà uno nuovo; `wasm/vectors.test.ts` passa;
`wasm/core.test.ts` prova sul `.wasm` vero l'andata e il ritorno promessi da
D-1 (a): il tratto UTF-16 di ogni commit, applicato alla stringa di prima, dà
il testo di `preview` (ASCII, due, tre e quattro byte, BOM, CRLF); il
surrogato spaiato è un errore e non un U+FFFD; dopo 10 000 giri di
`openCore`, `commit` e `close` la memoria del modulo non è più grande che
dopo il primo centinaio; senza il bersaglio, l'errore dice che cosa
installare.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npx
vitest run src/editors/canvas
Stato: [x] fatto · 81c8ec57 (+ 016ca37e, 199bcdf0) · check --rapido verde (4 test scaduti sotto carico, verdi da soli)
  Risposta (2026-11-03): l'utente approva la riga di `CLAUDE.md` e di
  `CONTRIBUTING.md` con il bersaglio `wasm32-unknown-unknown`. La parte di
  `.github/workflows/ci.yml` la fa l'orchestratore, non il coder.

## T15 · La CSP, la decisione e la misura

Perché: la WebView deve poter compilare WebAssembly, la scelta va scritta, e
i tempi vanno misurati dove girano davvero prima che la tela ci passi. D-3
(a): si apre solo `'wasm-unsafe-eval'`, e all'utente è promesso un test che
tiene vietato eseguire testo come codice.
Tocca: `crates/fub-app/tauri.conf.json` (solo `csp`),
`crates/fub-app/tests/platform_configs.rs`,
`docs/reference/permissions-and-security.md`, `docs/decisions/0236-…md`
(nuovo, numero secondo A12), `docs/decisions/README.md`,
`apps/client/bench/webview/run.mjs`, `apps/client/bench/webview/budgets.json`,
`docs/misure/lavagna-wasm-AAAA-MM-GG.md` (nuovo), `docs/misure/README.md`.
Non toccare: `crates/fub-services/src/site_isolation.rs` (è la CSP dei siti
pubblicati, un'altra cosa); le altre voci della CSP; il client.
Dipende da: T14; D-3 (a), risposta del 2026-11-02
Cosa fare:
- `script-src 'self' 'wasm-unsafe-eval'`, nient'altro; la pagina della
  sicurezza dice perché e che cosa non permette.
- Il test in `platform_configs.rs`, con `config_for` per ogni piattaforma
  (Linux, Windows, macOS, Android, iOS) e anche per `devCsp` se c'è: legge
  la CSP direttiva per direttiva e fallisce se `'unsafe-eval'` compare in
  una direttiva qualsiasi, se `'wasm-unsafe-eval'` compare fuori da
  `script-src`, o se `script-src` manca o non è esattamente `'self'
  'wasm-unsafe-eval'` (niente `'unsafe-inline'`, `data:`, `blob:`, `*` o
  altre origini). La funzione che controlla ha i suoi casi in negativo: una
  CSP con `'unsafe-eval'` in `script-src`, una con `'wasm-unsafe-eval'` in
  `default-src`, una senza `script-src`, una con `'UNSAFE-EVAL'` in
  maiuscolo fra spazi doppi (le parole chiave della CSP non guardano le
  maiuscole), e il controllo le rifiuta tutte.
- La decisione: WebAssembly nella WebView per la lavagna, l'ABI C (D-1), la
  build da Vite (D-2), la CSP e il suo test (D-3); nel registro delle
  decisioni.
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
scrive); una config di piattaforma che un giorno ridefinisce `csp` (il test
la prende, perché legge la config fusa).
Fatto quando: `cargo test -p fub-app --test platform_configs` passa, e
fallisce se nella CSP di una piattaforma qualsiasi compare `'unsafe-eval'` o
se `'wasm-unsafe-eval'` compare fuori da `script-src` (lo provano i casi in
negativo); la shell costruita carica il nucleo senza errori di CSP nella
console; la pagina di misura ha i numeri di Node e di WebKitGTK (dal job
`webview` della CI se in locale non si costruisce l'app).
Prova: scripts/check.sh --rapido; cargo test -p fub-app --test
platform_configs; cd apps/client && npm run bench:webview --
--only=<lo scenario nuovo> (con l'app costruita, come dice
`docs/development/webview-measurements.md`)
Stato: [x] fatto · 8adf925e · check --rapido verde (31 passi, 3m42s); ci.yml L1 in 57f11a32

## T16 · La tela usa il nucleo

Perché: finché la tela scrive col suo TypeScript, Rust e WebView possono
ancora divergere; da qui ogni modifica della tela passa dal nucleo. D-5 (c):
il testo di una scheda si registra a pause, non a ogni tasto.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/wasm/core.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/architecture/editor-surfaces.md`
(una sezione «La lavagna» nuova).
Non toccare: `model.ts`, `operation.ts`, `source-edit.ts` (si svuotano in
T18); i vettori; `bootstrap.ts`; `apps/client/src/state/` (le bozze sono di
T19).
Dipende da: T15; D-5 (c), risposta del 2026-11-02. Le regole del campo sono
A14–A16: l'orchestratore le fa vedere all'utente prima di far partire
questo task (A14 è la domanda D-10).
Cosa fare:
- La superficie si monta come `mountVectorSurfaceLazily` di
  `apps/client/src/editors/spatial/lazy.ts`: tiene il testo finché il nucleo
  non è pronto (prima lavagna aperta, poi resta, A6), poi crea la tela.
- `setDoc` e `syncDoc` aprono o fanno `reset`; `#commitLocal` passa le toppe
  a `commit` e usa il tratto cambiato per il testo nuovo e la
  `TextOperation`; l'annulla passa le toppe inverse dallo stesso `commit`;
  `revealSource` usa `nodeAt`; `close` quando la superficie si distrugge.
- Il testo di una scheda (oggi `#commitLocal` a ogni `input`) resta nel
  campo e si registra (un `commit` al nucleo, una modifica alla sessione)
  dopo una pausa di circa 250 ms (una costante, `CARD_PAUSE_MS`),
  all'uscita dal campo, a Invio e a Esc, secondo A14 e A15. Ogni
  registrazione è un passo d'annulla (A16); con il campo aperto Ctrl+Z
  resta quello del campo.
- Il testo in sospeso ha un posto solo nel motore (per esempio `#pending`:
  la scheda, il campo, il testo) e si registra prima di ogni altra cosa che
  tocca la lavagna o la chiude: un altro gesto della tela, `undo`, `redo`,
  `setReadOnly`, `destroy`. A `syncDoc` si registra subito dopo, sul testo
  nuovo (la regola dello `Stale` qui sotto). T19 lo fa vedere alla
  sessione: va scritto in modo che basti esporlo.
- Una registrazione che il nucleo rifiuta non butta il testo del campo. Se
  il testo è cambiato da un'altra parte (`Stale`), il testo del campo si
  registra sulla scheda com'è adesso; se la scheda non c'è più, si rimette
  com'era col testo del campo, e un annulla la toglie. Se passa un limite
  (`Invalid`: più di 1 MiB di testo), il campo resta aperto col testo e
  l'avviso lo dice (chiave nuova nel catalogo, per esempio «Il testo di
  questa scheda supera 1 MiB: accorcialo per salvarlo.»).
- Se il nucleo non si carica: l'avviso (chiave nuova nel catalogo, per
  esempio «Questa lavagna non si può disegnare ora: il testo è nella vista
  Sorgente.») e la vista sorgente, come fa il caricamento pigro dei disegni.
- `engine.test.ts`: lo stesso comportamento di prima attraverso il nucleo, e
  il test del cancello che apre il testo di `agent-board.json` e trova le
  stesse schede negli stessi posti.
- La sezione «La lavagna» di `editor-surfaces.md`: la tela passa dal
  nucleo, quando si registra il testo di una scheda, che cosa fa l'annulla.
Casi limite: una modifica esterna mentre si scrive in una scheda; due
superfici sulla stessa lavagna; chiudere la superficie durante il
caricamento; chiudere la scheda o il riquadro, o aprire un altro documento
nel riquadro, durante la pausa; una trappola del nucleo a metà gesto (si
rifà l'istanza e si riapre dal testo della sessione); una composizione
dell'IME o un tasto morto (la pausa non scatta durante la composizione:
conta dalla sua fine); un incolla di 2 MiB in una scheda (se poi si
chiude il riquadro, è l'unico testo che non si salva: l'avviso l'ha già
detto, e un test lo fissa); CRLF (gli offset
della sessione sono a `\n`). Fino a T19 il testo in sospeso non è nelle
bozze: per questo N3 entra in main solo con T19 fatto (merge-n3n4 (b)).
Fatto quando: i test di `src/editors/canvas` passano col nucleo; la tela, nel
banco con l'host finto, apre, sposta, collega, scrive e annulla come prima
(foto del banco invariate, se ci sono); nessuna chiamata al nucleo per tasto
(un test lo conta); con l'orologio finto, `engine.test.ts` prova che: dieci
tasti a 100 ms l'uno dall'altro non registrano niente fino alla pausa, e poi
una volta sola; due frasi con una pausa in mezzo sono due passi d'annulla;
Esc, Invio, Ctrl+Invio, Cmd+Invio e l'uscita dal campo registrano come
dicono A14 e A15; `destroy` durante la pausa registra prima, nel documento
che il riquadro mostrava (il pannello stacca e distrugge la superficie prima
di cambiare documento, in `show`), e `syncDoc` subito dopo sul testo nuovo;
una registrazione `Stale` o `Invalid` non perde il testo del campo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [x] fatto · 7592cc3a · check --rapido 18/19: rossi solo theme/runtime e grid/engine a tempo (5 s), verdi da soli (88/88)

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
Stato: [x] fatto

## T18 · Il TypeScript della lavagna si toglie

Perché: con la parità provata e la tela sul nucleo, la copia TypeScript della
logica è solo un posto in più dove sbagliare. D-8 (a): si toglie, ma solo
dopo che ogni caso dei suoi test gira sui vettori comuni e passa, e
l'elenco lo dimostra.
Tocca: `apps/client/src/editors/canvas/model.ts` (restano i tipi e
`emptyCanvas` se serve al disegno), `operation.ts` (restano i tipi di
`CanvasPatch` e i costruttori di toppe che la tela usa),
`source-edit.ts` (si toglie), `source-edit.test.ts`, `operation.test.ts`,
`model.test.ts`, `line-endings.test.ts`, `vectors.test.ts`, `mirror.test.ts`
(diventa `wasm/mirror.test.ts`), `wasm/vectors.test.ts`,
`apps/client/src/__fixtures__/canvas-read/` (nuovo),
`apps/client/src/__fixtures__/canvas-patches/` e `canvas-ops/` (solo file
nuovi), `crates/fub-canvas-core/tests/read_vectors.rs` (nuovo),
`crates/fub-canvas-core/tests/ts_mirror.rs` (il commento in testa),
`docs/map/ownership.md`, `docs/reference/canvas-format.md` (sezione
«Parità»).
Non toccare: i file dei vettori che ci sono (un caso nuovo va in un file
nuovo); `engine.ts` salvo gli import; il disegno della tela;
`canvas-mirror.json` e il suo generatore, salvo il commento.
Dipende da: T16, T19 (tutti e due toccano `engine.ts`: uno alla volta); D-8
(a), risposta del 2026-11-02
Cosa fare:
- Prima di togliere un test, la tabella «test tolti → vettore»: una riga per
  ogni `it` e per ogni riga di un `it.each` di `model.test.ts`,
  `operation.test.ts`, `source-edit.test.ts`, `line-endings.test.ts` e
  `vectors.test.ts`, con il file, il nome del test, il vettore (o i
  vettori) che fa gli stessi casi, e se il vettore c'era o è nuovo. Un caso
  che non c'è diventa un vettore nuovo. La tabella va nel rapporto, e
  l'orchestratore la copia sotto questo task prima di segnarlo fatto.
- Le regole di lettura (R1–R5, R7, R8, i limiti per tipo) non hanno ancora
  vettori: i vettori delle toppe partono da un testo che si apre. Per loro
  `canvas-read/`, un file per caso: `name`, `description`, `source`, `expect
  {outcome: "opened", nodes, edges}` oppure `{outcome: "rejected",
  reason}`; li leggono `tests/read_vectors.rs` (con `Core::open`) e
  `wasm/vectors.test.ts` (con `openCore`).
- La prova «un vettore cambiato di un byte fallisce» di `vectors.test.ts`
  passa a `wasm/vectors.test.ts`, e vale anche per `canvas-read/`.
- Lo specchio resta, contro il `.wasm`: `mirror.test.ts` diventa
  `wasm/mirror.test.ts` e pretende dal nucleo in WebAssembly le risposte che
  la fixture porta dal nucleo nativo. La seconda copia è ora la build a 32
  bit (`usize` di 32 bit, un altro allocatore), dove una divergenza resta
  possibile; `ownership.md` e il commento di `ts_mirror.rs` lo dicono.
- Tolta la logica: `parseCanvas`, `commitCanvasPatches`, `canvasDraft`,
  `applyCanvasPatches`, `inverseCanvasPatches`, `patchCanvasSource`,
  `canvasNodeAt`, `sameCanvasModel`.
Casi limite: `editors/core/bootstrap.ts` e `editors/rich/surface.ts`
importano da `surface.ts` e `engine.ts` della lavagna, che restano: non
cambiano; un tipo di `model.ts` usato dal disegno resta; un test che prova
una cosa solo della tela (un tipo, `emptyCanvas`, un costruttore di toppe)
resta in un file che resta, e nella tabella si scrive così; un caso che il
nucleo fa diverso dal TypeScript (si scrive nel rapporto: se il nucleo segue
R1–R11 il vettore dice ciò che fa il nucleo, altrimenti è un errore del
nucleo, da correggere prima di togliere); `npm run typecheck` deve restare
verde.
Fatto quando: la tabella ha tante righe quanti sono i casi dei cinque file
(il conto, fatto con un comando scritto nel rapporto, torna), ogni vettore
che nomina esiste e passa in `cargo test -p fub-canvas-core` e in
`wasm/vectors.test.ts`; `grep -rn
"patchCanvasSource\|commitCanvasPatches\|parseCanvas" apps/client/src` non
trova più definizioni; `wasm/mirror.test.ts`, `wasm/vectors.test.ts` e i test
della tela passano; la prova del byte cambiato fallisce come deve su
`canvas-patches/`, `canvas-ops/` e `canvas-read/`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npm run typecheck && npx vitest run src/editors/canvas
Stato: [x] fatto · 3be6626d..1a87587e · check --rapido 32/33: rosso solo ui/views.test.ts a tempo (5 s) sotto carico, verde da solo (30/30)

## T19 · Il testo in corso di una scheda nelle bozze di recupero

Perché: da T16 il testo che si scrive in una scheda resta nel campo fino
alla pausa; D-5 (c) vuole che anche quello finisca nelle bozze di recupero,
così una chiusura ordinata non perde niente e una chiusura di colpo perde al
più l'ultimo secondo (A17).
Tocca: `apps/client/src/state/document-session.ts`,
`apps/client/src/state/document-session.test.ts`,
`apps/client/src/state/document-controller.ts` (dove la superficie si
registra alla sessione, `attachSurface`),
`apps/client/src/editors/core/registry.ts` (`SurfaceBuffer`),
`apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/shell.e2e.test.ts`, `docs/architecture/editor-surfaces.md`.
Non toccare: `crates/fub-kernel/src/drafts.rs` e l'IPC delle bozze (il posto
e il formato delle bozze non cambiano); `state/drafts.ts` (il recupero vale
già per ogni documento); `SAVE_MS` e quando si salva; il nucleo.
Dipende da: T16; D-5 (c), risposta del 2026-11-02
Cosa fare:
- Ciò che c'è già (letto nel codice): le bozze sono per documento, col testo
  intero (`saveDraft` → `fub-host` → `fub-kernel`, `.fub/drafts/`), e il
  recupero (`state/drafts.ts`, `restoreDraft`) vale per ogni documento,
  anche un `.canvas`. Mancano due cose: la sessione non vede il testo che è
  solo nel campo, e il ritardo della bozza riparte a ogni modifica.
- La porta: `SurfaceBuffer` e `DocumentSurface` hanno due funzioni
  facoltative, `pendingText(): string | null` (il testo intero del
  documento col testo in sospeso dentro, fatto con `preview` di T13; `null`
  se non c'è niente in sospeso) e `commitPending(): void` (registra subito,
  come la fine della pausa). La tela avvisa la sessione a ogni cambio del
  testo in sospeso (una notifica, nessuna chiamata al nucleo): la sessione
  conta una generazione di bozza in più e arma il ritardo.
- Il ritardo della bozza diventa una cadenza: `scheduleDraft` non riarma un
  ritardo già armato, così mentre si scrive senza fermarsi parte una bozza
  ogni `DRAFT_MS`. Vale per tutti i documenti (A17).
- `#writeDraft` scrive `pendingText()` se una superficie ne ha uno, se no il
  testo della sessione; scrive anche quando la sessione è pulita ma c'è un
  testo in sospeso; `#bufferProtected` conta anche quello. Un salvataggio
  riuscito non toglie la bozza se c'è ancora un testo in sospeso.
- Un metodo privato solo della sessione (per esempio `#settlePending()`)
  chiama `commitPending()` delle superfici in testa a ogni metodo che salva,
  scrive la bozza, sostituisce il buffer o chiude la sessione. Con i nomi di
  adesso: `flush`, `flushDraft`, `handleExternalChange`, `reloadIfClean`,
  `forceReload`, `resolveConflict`, `saveKeepingMine`, `discardChanges`,
  `restoreDraft`, `beginDeletion`, `delete`, `rename`, `suspend`, `close`;
  e i metodi della collezione che ci arrivano (`flushPendingSave`,
  `flushBeforeClose`, `release`, `renameKeepingBuffer`, `discardUnsaved`,
  `handleExternalRemoval`) passano da lì. Così una modifica o una rimozione
  esterna che arriva durante la pausa trova la sessione già sporca, e
  diventa il conflitto di sempre invece di una ricarica.
- Il pannello (`document-controller.ts`) chiama `commitPending()` prima di
  `detachSurface` in ogni via che stacca una superficie (`show`,
  `retryShow`, `failSurface`, la chiusura di un riquadro,
  `resetDocumentsForVault`, la fine della vita del pannello): il testo
  arriva alla sessione del documento che il riquadro mostra ancora, prima di
  ogni flush. Da qui la registrazione dentro `destroy` di T16 è solo una
  rete: un test fa vedere che, in ogni via, a `destroy` non resta niente in
  sospeso.
- `editor-surfaces.md`: la porta del testo in sospeso, la cadenza della
  bozza e che cosa protegge (A17).
Casi limite: due superfici della stessa lavagna con un testo in sospeso
(prima si registrano tutte e due, poi si scrive la bozza del testo della
sessione); `preview` che fallisce (`Stale` o `Invalid`: la bozza tiene
l'ultimo testo che il nucleo accetta, e la cosa si scrive nel log); una
bozza che fallisce sul disco (la chiusura lo sa già da `#bufferProtected`);
la sessione sospesa o in cancellazione; una nota di qualche MiB scritta
senza fermarsi (una bozza per volta: `#draftWork` non ne accoda una seconda
uguale); una superficie distrutta fra la notifica e la bozza; il ritardo che
scatta mentre il nucleo si sta caricando.
Fatto quando: con l'orologio finto, l'host finto e la tela vera (il motore e
il `.wasm`, non una superficie finta) attaccata alla sessione,
`document-session.test.ts` (o un file nuovo accanto) prova che: tre secondi
di tasti a 100 ms l'uno dall'altro in una scheda scrivono tre bozze, ognuna
col testo del campo di quel momento, e nessuna scrittura del file; **Fub si
chiude di colpo durante la pausa dei 250 ms**: si scrive «Ciao mondo» in una
scheda, un tasto ogni 100 ms; a 1 s parte la bozza, e la pausa non è ancora
finita; a 1,1 s la collezione si butta senza chiudere niente (Fub ucciso);
una collezione nuova sullo stesso host finto offre la bozza con «Ciao
mondo», e `restoreDraft` la rimette nella lavagna; ciò che si è scritto dopo
l'ultima bozza è al più `DRAFT_MS` di tasti (il test lo misura); in una
nota, scrivere senza fermarsi scrive una bozza al secondo.
`shell.e2e.test.ts` prova che chiudere la finestra durante la pausa porta il
testo della scheda al disco o alla bozza (come «l'ultima battuta va sul
disco invece di sparire» per le note), e che una modifica esterna durante la
pausa dà il conflitto e non perde il testo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/state
src/editors/canvas src/shell.e2e.test.ts
Stato: [x] fatto · b9ef72e8 + f56444dc · check --rapido verde (19 passi)

## T20 · Il nucleo conserva ciò che non tocca

Perché: D-7 (c): Fub apre le lavagne degli altri programmi e, quando
riscrive, conserva esattamente ciò che non tocca (R7 cambiata, R11). Il
ritocco lo fa già per la grafia dei numeri, gli spazi, l'ordine e i campi
sconosciuti; mancano i `null` dei campi noti, gli array assenti e il posto
degli archi.
Tocca: `crates/fub-canvas-core/src/source.rs`,
`crates/fub-canvas-core/src/patch.rs`, `crates/fub-canvas-core/src/ops.rs`,
`crates/fub-canvas-core/tests/source_edit.rs`,
`crates/fub-canvas-core/tests/patch.rs`,
`crates/fub-canvas-core/tests/op_vectors.rs`,
`apps/client/src/__fixtures__/canvas-patches/` (i vettori 11 e 18, e file
nuovi), `apps/client/src/__fixtures__/canvas-ops/` (file nuovi),
`apps/client/src/editors/canvas/operation.ts` (solo `removeEdgePatch`, che
passa `at`), `crates/fub-features/src/lavagna/` (solo un test),
`docs/reference/canvas-format.md` (R7, «Scrittura»),
`docs/reference/canvas-operations.md` (le toppe degli archi, «L'inversa»).
Non toccare: le regole di lettura (`read.rs`); `js.rs`; `commit.rs`; i
vettori che non cambiano per D-7 (c); `engine.ts` (l'annulla della tela è
di T21).
Dipende da: T18 (una copia sola da cambiare: il TypeScript non c'è più);
D-7 (c), risposta del 2026-11-02
Cosa fare:
- `source.rs`: un campo noto facoltativo che nel sorgente è `null` e nel
  modello di dopo è assente resta com'è (non conta come tolto, e la scheda
  non si ricompone per lui); se prende un valore, il valore va al posto del
  `null`. Un `nodes` o `edges` assente nel sorgente e vuoto nel modello di
  dopo non si aggiunge; con la prima voce arriva in fondo, come oggi.
- Le toppe degli archi hanno `at` facoltativo, come le schede:
  `upsert-edge` nuovo e `remove-edge` lo portano, l'inversa di
  `remove-edge` rimette l'arco in `at`, e `inverse` riordina gli `at` come
  per le schede. Senza `at` tutto resta come prima (il vettore 16 non
  cambia). È un campo nuovo nel JSON delle toppe: la pagina
  `canvas-operations.md` lo dice, e i vettori sono la prova di conformità.
- `ops.rs`: `remove` scrive l'`at` degli archi che toglie; `op_vectors.rs`
  confronta gli archi in ordine (senza più `by_edge_id`).
- I vettori 11 e 18 cambiano testo (il 18 diventa
  `18-null-kept-on-rewrite.json`), con la ragione nel campo `description`.
  Cambiare un vettore è cambiare un test: lo autorizza la risposta D-7 (c),
  solo per questi due.
  Almeno 12 vettori nuovi fra `canvas-patches/` e `canvas-ops/`: una
  lavagna scritta come la scrive Obsidian (rientri di tabulazioni, campi
  nell'ordine di Obsidian) con uno spostamento e un'aggiunta; `null` su
  `color`, `label`, `background`, `subpath` in una scheda che si ricompone;
  un `null` che prende un valore; `1.0`, `1e2`, `-0` e `1E1` in una scheda
  che si ricompone per un altro campo; un numero sconosciuto `1.50` accanto;
  le chiavi che sembrano indici in una scheda che si ricompone; un arco
  tolto in mezzo e rimesso dall'annulla al suo posto; `edges` assente, una
  scheda aggiunta e tolta; `"edges": null` con una scheda nuova; escape
  scritti in un altro modo (`"\u00e9"`, `"\/"`) in un campo che non cambia.
- Un test in `fub-features` (`lavagna/`): `canvas.apply` su una lavagna
  scritta come Obsidian sposta una scheda e cambia solo i byte di quella
  coordinata.
- Le pagine: R7 e la «Scrittura» di `canvas-format.md` (anche la frase su
  `nodes` ed `edges` che arrivano in fondo), «L'inversa» e la tabella delle
  toppe di `canvas-operations.md`.
Casi limite: un `null` su un campo obbligatorio (resta un errore di
lettura, R7); un `null` di un campo che non vale per quel tipo (`url` su una
scheda di testo); un arco col suo `at` oltre la fine; togliere una scheda e
i suoi archi insieme, poi annullare (gli archi tornano nel loro ordine);
`edges` assente e una scheda tolta; un file a una riga sola; CRLF; BOM.
Fatto quando: `cargo test -p fub-canvas-core` e `wasm/vectors.test.ts`
passano coi vettori nuovi e con i vettori 11 e 18 cambiati; ogni vettore
nuovo ha il testo atteso scritto a mano, e il suo `description` dice quali
byte cambiano e perché tutti gli altri restano; il test di `canvas.apply`
passa; `node .github/scripts/check-doc-links.mjs` è verde.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cargo test
-p fub-features lavagna; cd apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T21 · L'annulla della tela torna ai byte di prima

Perché: D-7 (c): l'annulla della tela applica le toppe inverse, che
riscrivono ciò che rimettono (una scheda rientrata torna compatta, `1e2`
torna `100`, un `nodes` che non c'era o era `null` resta `[]`: vettori 12,
14, 19, 22).
L'annulla dei comandi (`Undo::of_edits`) torna già ai byte di prima; quello
della tela deve fare lo stesso.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`docs/architecture/editor-surfaces.md` (la sezione «La lavagna»).
Non toccare: il nucleo e i vettori (le toppe inverse restano giuste e
restano la via quando il testo è cambiato); `state/`; `operation.ts`.
Dipende da: T18, T19 (`engine.ts`, uno alla volta); D-7 (c), risposta del
2026-11-02
Cosa fare:
- Ogni passo d'annulla tiene, oltre alle toppe, il tratto di testo che il
  commit ha cambiato (inizio, fine, testo di prima, testo di dopo, come lo
  dà `commit`) e la versione del testo dopo il passo (un contatore del
  motore che cresce a ogni testo nuovo, anche da `syncDoc`).
- Annulla e ripeti: se il testo di adesso è quello lasciato dal passo (la
  versione torna), si rimette il tratto di prima con `reset` sul testo
  esatto, e la `TextOperation` è quel tratto; se no, le toppe inverse come
  oggi, che fondono il passo con ciò che è cambiato da un'altra parte. Un
  `reset` costa una lettura intera (prova 1): va bene per un annulla, non
  per ogni gesto.
- La sessione e le altre superfici ricevono una modifica come le altre
  (stessa `onChange`): niente cambia per loro.
Casi limite: annullare dopo una modifica dalla vista Sorgente in un altro
riquadro (via delle toppe); annulla, ripeti, annulla; il limite di
`MAX_CANVAS_HISTORY` passi; un passo grande (togliere 1000 schede); un
passo fatto prima di una `syncDoc` che non cambia il testo (la versione
resta); CRLF e BOM; un passo di testo di una scheda (T16) annullato.
Fatto quando: `engine.test.ts` prova, sui testi di partenza dei vettori 02,
12, 14, 19 e 22 e su una lavagna scritta come Obsidian, che ogni gesto
della tela (spostare, ridimensionare, togliere, aggiungere, collegare,
scrivere in una scheda, cambiare colore, riordinare) seguito da un annulla
ridà il testo di prima byte per byte, e un ripeti il testo di dopo; e che
dopo una modifica da un'altra superficie l'annulla passa dalle toppe e dà
il modello giusto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T22 · Una lavagna che Fub non può riscrivere si apre in sola lettura

Perché: una lavagna con una chiave sconosciuta doppia si apre (R3), ma il
riscrittore la rifiuta, perché riscriverla perderebbe uno dei due valori:
oggi ogni gesto torna indietro senza un perché. D-7 (c) vuole che Fub non
tolga niente; A18 vuole che lo dica.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/reference/canvas-format.md`
(R3).
Non toccare: il nucleo e le sue regole (R3 resta: si apre, non si
riscrive); `setReadOnly` del pannello e i suoi motivi (la sola lettura di
questo caso è della tela, e si somma a quella del pannello); i comandi, che
rispondono già con `canvas.apply.e_commit_rejected`.
Dipende da: T20 (`canvas-format.md`), T21 (`engine.ts`); D-7 (c), risposta
del 2026-11-02
Cosa fare:
- A ogni `setDoc` e a ogni `syncDoc` col testo intero, la tela chiede al
  nucleo se il testo si può riscrivere (un `commit` di una lista vuota
  risponde `rejected` con la ragione della chiave doppia); se no, la tela si
  mette in sola lettura con lo stato che c'è già (i bottoni che cambiano
  spenti) e l'avviso nel posto dell'avviso della barra
  (`canvas-intake-error`), con una chiave nuova nel catalogo, in tutte le
  lingue, per esempio «Questa lavagna si può guardare ma non cambiare: il
  file ha lo stesso campo due volte, e riscriverlo ne perderebbe uno.».
- Quando il testo torna riscrivibile (la chiave doppia tolta nella vista
  Sorgente), la sola lettura e l'avviso se ne vanno da soli.
- La pagina `canvas-format.md`, R3: che cosa fa la tela.
Casi limite: la chiave doppia annidata in un campo sconosciuto; la chiave
doppia tolta da un'altra superficie mentre la tela è aperta; un file con
la chiave doppia e oltre il limite interattivo (vince l'avviso del limite:
uno solo per volta); la sola lettura del pannello che arriva e se ne va
mentre questa resta.
Fatto quando: `engine.test.ts` prova, con il testo dei vettori 32 e 33, che
la tela si apre, disegna le schede, non cambia niente a nessun gesto, mostra
l'avviso con il suo ruolo `alert`, e che togliendo la chiave doppia torna a
cambiare; il controllo delle chiavi del catalogo è verde.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T23 · La CI completa e la revisione prima del merge

Perché: merge-n3n4 (b): N3 entra in main solo quando è finito, dopo la CI
completa (che sulla PR in bozza non gira tutta) e una revisione riga per
riga; poi entra N4.
Tocca: nessun file di prodotto in partenza; ciò che la CI o la revisione
trovano, nei file dei task che l'hanno scritto.
Non toccare: N4 e N6 (li riallinea il loro pianificatore); la storia del
ramo (niente force-push senza chiedere).
Dipende da: T13, T14, T15, T16, T18, T19, T20, T21, T22 (tutti i task)
Cosa fare (lo fa l'orchestratore):
- Segna la PR #297 pronta (non più in bozza), così parte la CI completa:
  Linux, Windows, macOS, i banchi (visivo, `bench:webview`, `bench:ink`) e
  i job del client col bersaglio WebAssembly di T14.
- Legge ogni job, anche quelli verdi con avvisi; un job rosso o un avviso
  nuovo diventa una correzione, con un coder se serve, e la CI riparte.
- Fa la revisione riga per riga di tutto il diff di N3 contro main, con le
  domande di sempre: perdita di dati, sicurezza (la CSP, l'`unsafe` del
  ponte), contratti (le pagine di `docs/reference/`), test che provano la
  frontiera vera, testi per l'utente, gergo vietato; corregge ciò che trova.
- Controlla che ogni riga del cancello abbia la sua prova verde.
- Chiede all'utente il merge, con il resoconto: che cosa c'è, che cosa è
  cambiato per lui, che cosa resta fuori (D-9), la CI e la revisione.
Casi limite: un job che fallisce per una ragione che non è di N3 (si scrive
e si chiede); un conflitto con main nel frattempo (si riallinea il ramo e la
CI riparte); WebView2 di Windows che rifiuta `'wasm-unsafe-eval'` (è un
difetto di T15, non un avviso).
Fatto quando: la PR #297 non è in bozza, tutti i controlli della CI completa
sono verdi, il resoconto della revisione è nel rapporto con ogni punto
corretto o motivato, ogni riga del cancello ha la sua prova, e l'utente ha
detto sì al merge.
Prova: gh pr checks 297; scripts/check.sh
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
- Che WebView2 di Windows e WKWebView di macOS e iOS accettino
  `'wasm-unsafe-eval'` come WebKitGTK: non lo prova nessun test qui. T23
  guarda se un job della CI carica la shell su quelle piattaforme, e se
  nessuno lo fa lo dice all'utente prima del merge.
- Quanto costa una bozza al secondo mentre si scrive in un documento di
  qualche MiB (T19): non misurato; il test di T19 conta le bozze, non il
  tempo.
- Che cosa fa Obsidian con un `null` o un `edges` assente quando riscrive:
  T20 conserva, e non lo imita.
