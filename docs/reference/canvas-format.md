# Il formato della lavagna

> **Ambito:** il nucleo della lavagna, `fub-canvas-core`: il modello di una
> `.canvas` (JSON Canvas 1.0) e le regole con cui Fub la legge e la scrive.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/`,
> `crates/fub-format-canvas/schema/canvas-v1.schema.json` e
> `crates/fub-abi/tests/dependency_invariant.rs`.

Una lavagna è un file `.canvas` nel formato [JSON Canvas
1.0](https://jsoncanvas.org/spec/1.0/), lo stesso di Obsidian: schede (`nodes`)
in ordine di profondità crescente, archi (`edges`) fra le schede, e qualunque
altro campo, che Fub conserva così com'è.

## Il nucleo

`fub-canvas-core` è il posto dove sta ciò che ogni parte di Fub fa con una
lavagna, scritto una volta sola:

- `model`: i tipi del modello (`Canvas`, `CanvasNode`, `CanvasEdge`, i colori,
  i lati e gli estremi degli archi), i limiti (`MAX_SOURCE_BYTES`,
  `MAX_NODES`, `MAX_EDGES`, …), l'errore `CanvasError` e `Canvas::validate`.
  Ogni livello (la radice, ogni scheda, ogni arco) tiene in `extra` i campi
  che il modello non conosce, `fub:ink` compreso: la sua forma è in
  [L'inchiostro della lavagna](canvas-ink.md).
- `read`: `parse(source)`, dal testo del file al modello validato.
- `ink`: i livelli d'inchiostro `fub:ink` delle schede e della radice.
  `read_layers(&canvas)` li dà tutti, nell'ordine di `nodes` e poi la radice,
  e `layer(&canvas, &LayerRef)` uno solo (`LayerRef` è `"board"` oppure
  `{"node": id}`). Un livello è valido (`InkLayer`, coi suoi `InkStroke`) o
  estraneo (`ForeignLayer`, il perché); un tratto si disegna (`DrawnStroke`,
  già decodificato) o si conserva con la ragione (`SkipReason`). La stringa
  `ink` e il pennello si controllano con `fub-ink-codec` e i suoi limiti. Il
  livello resta nei campi sconosciuti di chi lo tiene, e `InkLayer::to_value`
  lo riscrive uguale per valore. Le regole sono in [L'inchiostro della
  lavagna](canvas-ink.md); i vettori li legge `tests/ink_vectors.rs`.
- `js`, `source`, `patch`, `ops`: la scrittura come la fa JavaScript, il
  ritocco del sorgente, le toppe con la loro inversa e le operazioni
  d'intento.
- `commit`: la lavagna aperta, `Core` (il sorgente e il suo modello), e
  `Core::commit(toppe)`, tutte o nessuna. Dà il sorgente nuovo, le toppe
  inverse per l'annulla e il tratto minimo cambiato (`Edit`: `start` ed `end`
  in byte UTF-8 del sorgente di prima, mai a metà di un carattere). Un
  rifiuto (`CommitError`) lascia `Core` com'era; i casi sono in
  `crates/fub-canvas-core/tests/commit.rs`.

Il nucleo è **puro**. Dipende soltanto da `serde`, `serde_json`, `thiserror`
e dal codec dei tratti `fub-ink-codec` (che porta con sé il nucleo
dell'inchiostro `fub-ink`, puro come lui); non vede il contratto (`fub-abi`), il Markdown, il kernel né un toolkit, non fa
I/O e compila per `wasm32-unknown-unknown`, perché la WebView lo carica come
modulo WebAssembly. Non va mai in panico su un input: ogni errore è un
`CanvasError`.

`serde_json` vi entra con la feature `float_roundtrip`, così un decimale si
rilegge esatto e non a meno dell'ultima cifra. Le feature di Cargo si
uniscono: dovunque ci sia il nucleo, ogni `serde_json` del grafo legge i
decimali così.

### Chi lo usa

L'elenco è chiuso, e `the_canvas_core_stands_alone` in
`crates/fub-abi/tests/dependency_invariant.rs` lo verifica insieme alle
dipendenze dirette. Nella chiusura del nucleo i soli membri del workspace
ammessi sono `fub-ink-codec` e `fub-ink`, per l'inchiostro delle schede
(un'eccezione nominata, `CANVAS_CORE_ALLOWED_MEMBERS`); il nucleo è a sua
volta fra i clienti ammessi del codec (`the_ink_codec_stands_alone`).

| Cliente | Che cosa ne fa |
|---|---|
| `fub-format-canvas` | il provider del formato: riespone il modello e `parse_canvas` con la stessa API, e ci costruisce sopra `DocumentModel`, l'HTML statico e la riscrittura dei link. L'id del formato (`FORMAT_ID`) e la versione dello schema (`SCHEMA_VERSION`) restano suoi. |
| `fub-features` | ammesso per i comandi della lavagna (bundle `fub.lavagna`, feature `lavagna`), che arrivano con N3. |
| `fub-canvas-wasm` | ammesso per la facciata WebAssembly che la WebView caricherà, che arriva con N3. |

Il solo cliente presente è `fub-format-canvas`. Aggiungere un cliente all'elenco è
una decisione: si scrive qui e poi nel test.

### Come si prova

- `cargo test -p fub-canvas-core` e `cargo test -p fub-format-canvas`;
- `cargo test -p fub-abi --test dependency_invariant`;
- `cargo check -p fub-canvas-core --target wasm32-unknown-unknown --locked`,
  nel giro completo di `scripts/check.sh` (saltato se il bersaglio non è
  installato).

## Lettura

`parse` rifiuta un sorgente oltre `MAX_SOURCE_BYTES`, salta un BOM iniziale
senza toglierlo dal file e passa il modello a `Canvas::validate`. Rust e
TypeScript (`parseCanvas` in `apps/client/src/editors/canvas/model.ts`)
leggono con le stesse regole, così aprono e rifiutano gli stessi file; ogni
regola ha i suoi casi in `crates/fub-canvas-core/tests/read_rules.rs`. Nel
dubbio si apre e si conserva.

- **R1 · Vuoto.** Un BOM facoltativo, poi solo spazi JSON (spazio, `\t`,
  `\n`, `\r`): una lavagna vuota (`read::is_blank`). `"\u{feff}"` da solo è
  vuoto; `"\u{85}"` da solo no, ed è un errore di lettura.
- **R2 · Numeri dei campi noti.** `x`, `y`, `width` e `height` sono interi
  entro ±(2^53−1) (`model::MAX_SAFE_INTEGER`), comunque scritti: `"x": 1e2`
  vale 100, `"x": 1.0` vale 1, `"x": -0` vale 0. `"x": 1.5` e
  `"x": 9007199254740992` sono errori che nominano il campo. `width` e
  `height` almeno 1.
- **R3 · Chiavi doppie.** Una chiave nota doppia sulla radice, in una scheda o
  in un arco è un errore: `{"nodes":[],"nodes":[]}`. Una chiave sconosciuta
  doppia tiene l'ultimo valore nella posizione della prima, come
  `JSON.parse`: `"k":1,"z":2,"k":3` dà `k` = 3, poi `z`.
- **R4 · Surrogati spaiati.** `"\ud800"`, in una chiave o in un valore, è un
  errore; una coppia intera (`"\ud83d\ude00"`) è un carattere come gli altri.
- **R5 · Numeri fuori campo.** Un numero che un `f64` non tiene è un errore
  dovunque sia, anche in un campo sconosciuto: `{"fub:ink":1e400}`. Un numero
  che si arrotonda a zero (`1e-400`) si legge 0.
- **R7 · `null` è assente.** `"color": null`, `"label": null` e ogni altro
  campo noto facoltativo `null` valgono come assenti, e non finiscono fra i
  campi sconosciuti; `{"nodes": null}` è una lavagna vuota, anche con `edges`
  assente. Quando Fub riscrive quella scheda, il `null` sparisce. Un campo
  obbligatorio `null` (`"x": null`) resta un errore.
- **Limiti per tipo.** Ogni campo di testo noto è una stringa; le regole
  valgono solo sulla scheda del suo tipo (`text` fino a 1 MiB su `text`,
  `file` non vuoto fino a 8192 byte e `subpath` con `#` fino a 1024 byte su
  `file`, `url` su `link`, `label` fino a 64 KiB su `group`). Un `subpath`
  senza `#` su una scheda di testo, o uno sfondo lungo, si conservano.
- **R8 · `backgroundStyle`.** Qualunque stringa si legge e si conserva:
  `"backgroundStyle": "tile"` resta `tile`; la tela disegna un valore che non
  conosce come assente. Lo schema `canvas-v1.schema.json` dice ciò che Fub
  scrive, non ciò che legge, e non cambia.

## Scrittura

Il sorgente si ritocca, non si riscrive: `source::patch_source(sorgente,
prima, dopo)` cambia solo i valori e gli oggetti che passano dal modello di
prima a quello di dopo, e il resto del file resta byte per byte (spazi, a
capo, ordine delle chiavi, campi sconosciuti, il modo in cui è scritto un
numero). È il porto di `patchCanvasSource`
(`apps/client/src/editors/canvas/source-edit.ts`); i casi sono in
`crates/fub-canvas-core/tests/source_edit.rs`.

- **Lo scanner** legge il sorgente una volta, in byte UTF-8: conta come
  spazio solo lo spazio JSON, lascia un BOM iniziale fuori dalla radice e
  rifiuta una chiave doppia a qualunque profondità, anche sconosciuta
  (`SourceError::DuplicateKey`, con l'offset della seconda). `source::node_at`
  dice quale scheda contiene un offset in byte.
- **Il confronto** è fra valori JSON: le chiavi in qualunque ordine, i numeri
  per valore (`1.0` e `1` sono uguali). Un valore uguale resta com'era.
- **Un oggetto** che tiene tutti i campi del sorgente e non ne aggiunge
  cambia solo i valori. Altrimenti si ricompone con il prefisso, il
  separatore (`,` se aveva un campo solo) e il suffisso che aveva: i campi
  tolti cadono, quelli nuovi vanno in fondo come `"chiave":valore` compatti.
- **`nodes` ed `edges`** si accoppiano per id: una voce rimasta tiene il suo
  testo anche se si sposta, una voce nuova si scrive compatta, un array che
  si svuota diventa `[]`. Il modello ha sempre `nodes` ed `edges`: una radice
  che si ricompone e non li aveva li riceve in fondo, come in TypeScript.
- **Un sorgente vuoto** (R1) diventa la lavagna scritta per intero, rientrata
  di due spazi e chiusa da `"\n"`; tiene il BOM e, se il file ne aveva, i
  terminatori CRLF.

Le regole dei byte nuovi:

- **R6 · Scrivere è `JSON.stringify`.** L'escape solo per `"`, `\` e i
  controlli; `/`, i caratteri non ASCII, U+2028 e U+2029 restano come sono. I
  numeri come `Number.prototype.toString`, anche quelli dei campi
  sconosciuti, che si scrivono come li riscriverebbe JavaScript dopo averli
  letti (`1.50` riscritto è `1.5`). Il codificatore è `js.rs`.
- **R7 · Il `null` sparisce.** Un `"color": null` vale assente: quando Fub
  ricompone quella scheda il campo cade; in una scheda che non cambia resta.
  `"edges": null` resta finché gli archi non cambiano.
- **R10 · L'ordine dei campi** di una scheda o di un arco scritti per intero:
  per le schede `id`, `type`, `x`, `y`, `width`, `height`, `color`, `text`,
  `file`, `subpath`, `url`, `label`, `background`, `backgroundStyle`; per gli
  archi `id`, `fromNode`, `fromSide`, `fromEnd`, `toNode`, `toSide`, `toEnd`,
  `color`, `label`. Poi i campi sconosciuti nel loro ordine, poi la regola di
  JavaScript: le chiavi che sembrano indici (`"0"`) vanno prima, in ordine
  crescente. Una chiave aggiunta a un oggetto che c'era va in fondo.
  `source::node_value` ed `edge_value` danno questo ordine.

Il lavoro è lineare: una scheda uguale prima e dopo si confronta come struct
e non diventa un valore JSON.

## Parità

Il commit di Rust e quello di TypeScript (`commitCanvasPatches` in
`apps/client/src/editors/canvas/operation.ts`) scrivono gli stessi byte e
rifiutano con le stesse ragioni. Lo fissano i **vettori delle toppe** in
`apps/client/src/__fixtures__/canvas-patches/`, che leggono tutti e due:
`crates/fub-canvas-core/tests/patch_vectors.rs` contro `Core::commit` e
`apps/client/src/editors/canvas/vectors.test.ts` contro
`commitCanvasPatches`.

Un vettore è un file `NN-nome.json`: `name` (il nome del file senza numero),
`description`, `before` (il testo grezzo di prima), `patches` (le toppe come
le scrive il TypeScript) ed `expect`:

- `{"outcome": "applied", "text": …, "undo": …}`: il testo di dopo e quello
  che danno le toppe inverse applicate al testo di dopo; senza `undo` è
  `before`;
- `{"outcome": "rejected", "reason": …}`: la ragione, una fra `stale` (una
  toppa non torna con il modello), `invalid` (la lavagna di dopo non è
  valida), `rejected` (il sorgente non si ritocca, per esempio una chiave
  doppia) e `unstable` (il testo scritto non si rilegge come la lavagna di
  dopo). `CommitError::reason` in Rust e `canvasCommitOutcome` in TypeScript
  danno la stessa parola.

Per aggiungerne uno si prende il numero dopo l'ultimo e si scrive l'atteso a
mano, byte per byte: non si copia l'uscita di uno dei due lati. I due test
falliscono con meno di 30 vettori, con un file che non si legge, con un
numero che salta e con un atteso cambiato di un byte. Una lista vuota di
toppe resta fuori: Rust la accetta come commit che non cambia nulla,
`commitCanvasPatches` dà `null`.
