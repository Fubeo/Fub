# Operazioni sulla lavagna

> **Ambito:** le toppe che cambiano il modello di una lavagna, i loro errori
> e la loro inversa per l'annulla; le operazioni d'intento che si compilano
> in toppe.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/patch.rs` e
> `crates/fub-canvas-core/src/ops.rs`, il comando in
> `crates/fub-features/src/lavagna/apply.rs` (test in
> `crates/fub-features/tests/lavagna.rs`), i loro test in
> `crates/fub-canvas-core/tests/patch.rs` e
> `crates/fub-canvas-core/tests/op_vectors.rs`, i vettori in
> `apps/client/src/__fixtures__/canvas-ops/`, la tela in
> `apps/client/src/editors/canvas/operation.ts` e, per la WebView, la
> facciata in `crates/fub-canvas-wasm/src/` (test in
> `crates/fub-canvas-wasm/tests/`).

Questa pagina dice come si cambia una lavagna. Il modello (schede, archi e
campi sconosciuti) e le regole di lettura e scrittura del file stanno nel
[formato della lavagna](canvas-format.md).

## Le toppe

Una **toppa** è un cambiamento del modello che porta con sé l'**immagine di
prima**: com'era la scheda o l'arco prima del cambiamento. Chi applica la
toppa controlla che il modello sia ancora così; se qualcuno l'ha cambiato nel
frattempo, la toppa non si applica.

Una toppa è un oggetto JSON con il campo `kind`. La forma è la stessa in Rust
(`CanvasPatch`) e in TypeScript (`CanvasPatch` di `operation.ts`), chiave per
chiave e nello stesso ordine.

| `kind` | `before` | `after` | `at` |
|---|---|---|---|
| `upsert-node` | la scheda com'era, o `null` | la scheda nuova | facoltativo |
| `remove-node` | la scheda com'era | `null` | facoltativo |
| `upsert-edge` | l'arco com'era, o `null` | l'arco nuovo | facoltativo |
| `remove-edge` | l'arco com'era | `null` | facoltativo |
| `reorder` | gli id delle schede, in ordine | gli stessi, nel nuovo ordine | no |
| `ink` | il tratto com'era, o `null` | il tratto nuovo, o `null` | sì, nei tratti |

La toppa `ink` è descritta nella sezione [Inchiostro](#inchiostro).

Nelle toppe delle schede `at` è una posizione nella lista delle schede, che è
anche la profondità: la prima scheda sta sotto tutte le altre. Nelle toppe
degli archi è una posizione nella lista degli archi.

### Mettere una scheda

Con `before` uguale a `null` la scheda è nuova: va in `at`, o in cima se `at`
manca. Con `before` la scheda c'è e cambia al suo posto; `at` allora non
conta.

```json
{ "kind": "upsert-node",
  "before": { "id": "n1", "type": "text", "x": 0, "y": 0, "width": 200, "height": 120, "text": "a" },
  "after": { "id": "n1", "type": "text", "x": 8, "y": 8, "width": 200, "height": 120, "text": "a" } }
```

### Togliere una scheda

La scheda non deve avere archi: si tolgono prima, nella stessa lista. `at` è
la posizione che aveva, e serve all'inversa per rimetterla lì.

```json
{ "kind": "remove-node",
  "before": { "id": "n1", "type": "text", "x": 0, "y": 0, "width": 200, "height": 120, "text": "a" },
  "after": null, "at": 0 }
```

### Mettere e togliere un arco

Un arco nuovo va in `at`, o in fondo alla lista degli archi se `at` manca.
Con `before` l'arco c'è e cambia al suo posto; `at` allora non conta. Le due
schede che collega devono esserci, anche se sono nuove nella stessa lista di
toppe. In `remove-edge` `at` è la posizione che l'arco aveva, e serve
all'inversa per rimetterlo lì.

```json
{ "kind": "upsert-edge", "before": null,
  "after": { "id": "e1", "fromNode": "n1", "toNode": "n2", "toEnd": "arrow" } }
```

```json
{ "kind": "remove-edge",
  "before": { "id": "e1", "fromNode": "n1", "toNode": "n2", "toEnd": "arrow" },
  "after": null, "at": 0 }
```

### Riordinare

`before` è l'ordine delle schede di adesso, tutto; `after` è lo stesso
insieme di id in un altro ordine.

```json
{ "kind": "reorder", "before": ["a", "b"], "after": ["b", "a"] }
```

## Tutte o nessuna

Una lista di toppe si applica in ordine, su una copia del modello (`draft`).
Se una toppa non si applica, non si applica nessuna, e il modello resta
com'era: non esiste uno stato a metà. `apply` sostituisce il modello con la
copia solo alla fine.

La copia controlla la struttura: immagini di prima, posizioni, archi e
permutazioni. Non controlla che il modello di dopo sia valido (per esempio
una scheda larga zero): lo fa chi scrive il file, prima di scriverlo.

## L'immagine di prima

L'immagine di prima si confronta come **valore** JSON (`same_value`): le
chiavi di un oggetto in qualunque ordine, i numeri per valore come in
JavaScript. Quindi `1` e `1.0` sono uguali, `-0` e `0` anche, e un intero
oltre 2^53 vale il suo arrotondamento. Gli elementi di un array contano
nell'ordine.

Questa scheda torna con quella dell'esempio sopra, anche se le chiavi sono
in un altro ordine e `x` è scritto `0.0`:

```json
{ "text": "a", "height": 120, "width": 200, "y": 0, "x": 0.0, "type": "text", "id": "n1" }
```

## Gli errori

Ogni errore (`PatchError`) dice quale toppa della lista non si applica
(`index`, da zero) e perché.

| Errore | Quando |
|---|---|
| `Stale` | l'immagine di prima non torna: la scheda o l'arco è cambiato, manca, o c'è già quando `before` è `null`; per `reorder`, l'ordine di adesso non è `before` |
| `AtOutOfRange` | `at` oltre la fine della lista delle schede, o di quella degli archi per una toppa di un arco (`list` dice quale) |
| `NodeHasEdges` | si toglie una scheda che ha ancora un arco |
| `MissingEndpoint` | un arco collega una scheda che non c'è |
| `NotAPermutation` | in `reorder`, `after` ha un id che non c'è, uno ripetuto o ne manca uno |
| `InkAtOutOfRange` | in `ink` che aggiunge, `at` oltre la fine dei tratti del livello |
| `ForeignLayer` | in `ink`, il livello è estraneo |
| `DuplicateStroke` | in `ink`, il tratto di dopo ha l'id di un altro tratto del livello |
| `EmptyInk` | in `ink`, `before` e `after` sono tutti e due `null` |

Il commit dà una ragione in una parola (`PatchError::reason`): `invalid` per
`ForeignLayer`, `DuplicateStroke` ed `EmptyInk`, che porterebbero a un
livello che Fub non scrive; `stale` per tutti gli altri.

Una toppa scritta male non arriva nemmeno alla copia: è un errore di
lettura. Sono scritte male, per esempio, un `kind` sconosciuto, un `after`
diverso da `null` in una toppa che toglie, un `at` negativo o con la
virgola.

```json
{ "kind": "remove-node",
  "before": { "id": "n1", "type": "text", "x": 0, "y": 0, "width": 200, "height": 120, "text": "a" },
  "after": null }
```

Su una lavagna dove un arco parte da `n1`, questa toppa dà `NodeHasEdges`.

## L'inversa

`inverse` dà le toppe che disfano una lista: ognuna rovesciata, in ordine
inverso. Applicata dopo la lista, ridà il modello di prima.

| Toppa | Inversa |
|---|---|
| `upsert-node` con `before` | `upsert-node` con `before` e `after` scambiati |
| `upsert-node` con `before` uguale a `null` | `remove-node` senza `at` |
| `remove-node` | `upsert-node` con `before` uguale a `null` e lo stesso `at` |
| `upsert-edge` con `before` | `upsert-edge` con `before` e `after` scambiati |
| `upsert-edge` con `before` uguale a `null` | `remove-edge` senza `at` |
| `remove-edge` | `upsert-edge` con `before` uguale a `null` e lo stesso `at` |
| `reorder` | `reorder` con `before` e `after` scambiati |
| `ink` | `ink` con `before` e `after` scambiati e lo stesso `at` |

Gli `at` di una lista di `remove-node`, e quelli di una lista di
`remove-edge`, sono le posizioni nel modello di partenza. Per questo l'inversa
riordina le voci da rimettere che stanno vicine nella lista e sono della
stessa lista (schede con schede, archi con archi): prima l'`at` più basso,
quelle senza `at` per ultime. Così ogni scheda e ogni arco tornano al loro
posto, e un arco non torna mai prima delle schede che collega.

```json
[{ "kind": "remove-node", "before": { "id": "b", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "b" }, "after": null, "at": 1 },
 { "kind": "remove-node", "before": { "id": "a", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "a" }, "after": null, "at": 0 }]
```

L'inversa rimette prima `a` in 0, poi `b` in 1.

Una voce tolta senza `at` non torna al suo posto: una scheda torna in cima,
un arco in fondo alla lista degli archi.

## Operazioni

Un agente o la sessione dal tablet non scrivono toppe: scrivono
**operazioni d'intento** (`CanvasOp`, in `crates/fub-canvas-core/src/ops.rs`),
come «sposta», «collega», «togli». `compile(canvas, ops, seed)` le traduce
nelle toppe qui sopra e dà `Compiled { patches, created }`: le toppe, che si
applicano con `draft` al modello di partenza e hanno la loro inversa, e gli
id creati.

Le operazioni si compilano in ordine, ognuna sul modello lasciato dalla
precedente: si può aggiungere una scheda e subito spostarla, ma non collegare
una scheda tolta prima. Valgono tutte o nessuna: con un errore non esce
nessuna toppa. Il modello di dopo resta valido: ogni scheda e ogni arco che
un'operazione mette passa le regole del [formato](canvas-format.md).

Un'operazione è un oggetto JSON con il campo `op`. Un campo che l'operazione
non conosce, o un numero con una frazione vera dove serve un intero, è un
errore di lettura: un errore di battitura non diventa uno spostamento di zero.

### `add_card`

Aggiunge una scheda in cima all'ordine. `node` è una scheda come nel file,
campi sconosciuti compresi; `id` è facoltativo (assente o `null`: lo dà il
seme).

```json
{ "op": "add_card", "node": { "type": "text", "x": 0, "y": 0, "width": 260, "height": 120, "text": "Idea" } }
```

### `move`

Sposta le schede `ids` di `dx`, `dy`. Le coordinate saturano a ±(2^53−1). Un
gruppo si sposta da solo: le schede dentro restano dove sono, come sulla
tela. Una lista vuota, o uno spostamento di zero, non dà toppe.

```json
{ "op": "move", "ids": ["f1"], "dx": 40, "dy": 0 }
```

### `resize`

Dà alla scheda `id` le misure nuove: almeno 1, e una misura enorme satura a
2^53−1.

```json
{ "op": "resize", "id": "f1", "width": 320, "height": 200 }
```

### `connect`

Aggiunge un arco in fondo alla lista. `edge` è un arco come nel file; `id` è
facoltativo come in `add_card`. Le due schede devono esserci; un arco da una
scheda a sé stessa va bene.

```json
{ "op": "connect", "edge": { "fromNode": "a", "toNode": "b", "toEnd": "arrow" } }
```

### `remove`

Toglie schede e archi. Gli archi che toccano una scheda tolta vanno via
prima, nella stessa operazione, e un arco nominato e toccato va via una volta
sola. L'`at` di ogni scheda tolta è la sua posizione all'inizio della serie
di `remove-node` di cui fa parte, e quello di ogni arco tolto la sua
posizione all'inizio della serie di `remove-edge`, anche se la serie viene
da più operazioni: così l'inversa rimette schede e archi al loro posto.

```json
{ "op": "remove", "ids": ["b", "e1"] }
```

### `set`

Cambia i campi di una scheda o di un arco. Un valore sostituisce quello di
prima al suo posto, o va in fondo se è nuovo; `null` toglie il campo, noto o
sconosciuto. `id`, e `type` di una scheda, non si cambiano.

```json
{ "op": "set", "id": "a", "fields": { "color": "4", "text": "nuovo", "fub:tag": null } }
```

### `reorder`

Porta le schede `ids` in cima all'ordine, nell'ordine dato; le altre restano
sotto nel loro ordine. Con tutti gli id, `ids` è l'ordine nuovo.

```json
{ "op": "reorder", "ids": ["b", "a"] }
```

### Gli id nuovi

Un id nuovo viene dal seme del chiamante (`seed`, un intero a 64 bit senza
segno): stesso seme e stesso modello, stessi id, così i vettori e l'annulla
restano deterministici. Il generatore è SplitMix64: a ogni id

```text
state = state + 0x9E3779B97F4A7C15
z = state
z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
z = (z ^ (z >> 27)) * 0x94D049BB133111EB
z = z ^ (z >> 31)
```

con l'aritmetica a 64 bit che si avvolge, e lo stato di partenza uguale al
seme. L'id è `z` in sedici cifre esadecimali minuscole, come quelli di
Obsidian: col seme 0 il primo è `e220a8397b1dcdaf`. Un giro di `compile` usa
un solo generatore, e salta gli id presi: quelli di schede e archi del modello
di partenza e ogni id entrato nel modello nello stesso giro. Un id dato a mano
segue la stessa regola: se è preso, è `DuplicateId`. `created` dice, in
ordine, gli id di ogni scheda, arco e tratto aggiunti, dati o generati. Gli
id dei tratti sono unici nel livello: un id generato per un tratto salta
quelli del suo livello.

### Gli errori delle operazioni

Ogni errore (`OpError`) dice quale operazione della lista non si compila
(`index`, da zero).

| Errore | Quando |
|---|---|
| `UnknownNode` | `move`, `resize` o `reorder` di un id che non è una scheda; un arco verso una scheda che non c'è |
| `UnknownEdge` | `remove` o `set` di un id che non è né una scheda né un arco |
| `DuplicateId` | un id dato che è già preso; un id ripetuto nella lista di `move`, `remove` o `reorder` |
| `TooMany` | la lavagna avrebbe più di 100 000 schede o 200 000 archi |
| `Invalid` | una scheda o un arco che il formato non accetta; `set` di `id` o `type`; un id che è sia una scheda sia un arco; un tratto che non si disegnerebbe |
| `UnknownStroke` | `erase_strokes` di un id che non è un tratto del livello |
| `ForeignLayer` | `add_strokes` o `erase_strokes` su un livello estraneo |

I vettori stanno in `apps/client/src/__fixtures__/canvas-ops/`, uno per file,
scritti a mano: `before`, `seed` facoltativo (0 se manca), `ops` e `expect`
con `outcome` (`applied`, `rejected` o `malformed`) e, secondo il caso,
`after`, `created` ed `error`. `crates/fub-canvas-core/tests/op_vectors.rs` li
fa girare e controlla anche che l'inversa delle toppe ridia `before`.

## Inchiostro

La toppa `ink` e le operazioni `add_strokes` ed `erase_strokes`, con i loro
esempi e i loro errori, stanno nell'[inchiostro della
lavagna](canvas-ink.md#toppa-e-operazioni). `move` e `resize` non toccano
l'inchiostro; `remove` lo porta via con la scheda, e l'annulla lo rimette.

## Comandi

`canvas.apply` («Applica operazioni alla lavagna») è il comando del
componente Lavagna (`fub.lavagna`, cargo feature `lavagna` di `fub-features`)
che porta una lista di operazioni in un file `.canvas` come **una modifica
sola**: un passo d'anteprima, un passo d'annulla. Scrive un documento solo
(`CommandScope::writing(CommandReach::Document)`).

| Parametro | Tipo | |
|---|---|---|
| `doc` | documento, obbligatorio | il file `.canvas`; un documento di un altro formato è `BadArgs` |
| `ops` | testo, obbligatorio | un array JSON di operazioni, come sopra; testo che non è un array di operazioni, o un array vuoto, è `BadArgs` |
| `base` | testo | la revisione su cui valgono le operazioni; se il documento ne ha già un'altra è `Conflict` |
| `seed` | testo | il seme degli id nuovi, un intero decimale da 0 a 2⁶⁴ − 1 (in stringa, perché un `u64` non sta in un numero JSON) |

Senza `seed` il seme è l'FNV-1a a 64 bit della revisione corrente: l'anteprima
e l'applicazione sulla stessa revisione danno gli stessi id. Due chiamate con
la stessa `base` non si applicano tutte e due: la seconda trova la revisione
scritta dalla prima ed è `Conflict`. Senza `base`, una scrittura avvenuta fra
la lettura e la scrittura fa fallire il CAS dell'host, come per ogni modifica
al testo.

Il comando apre il sorgente con il nucleo (un file che le regole di lettura
del [formato](canvas-format.md) non leggono è `BadArgs`), compila le
operazioni e fa il commit; all'host consegna il tratto minimo cambiato. Gli
errori hanno una frase loro in italiano e in inglese: ogni `OpError` è
`BadArgs` e conta la posizione dell'operazione da uno; del commit, `Invalid`
e `Rejected` sono `BadArgs`, `Stale` e `Unstable` (un difetto del nucleo, non
degli argomenti) sono `Internal`.

L'anteprima (`dry_run`) restituisce il piano con l'unica modifica e non
scrive. L'applicazione restituisce l'annulla (l'inversa che l'host dà della
modifica) e l'effetto `Custom` con namespace `fub.lavagna` e payload
`{"created": [...], "revision": "..."}`: gli id nati, nell'ordine di
`created`, e la revisione del file dopo. Operazioni che non cambiano un byte
non scrivono e non lasciano un annulla; l'effetto dice la revisione corrente.

`canvas.create` («Nuova lavagna», «New whiteboard») fa nascere una lavagna
vuota e la apre, con le regole dei nomi di `drawing.create`. Scrive un
documento solo e si annulla (`CommandScope::writing(CommandReach::Document)`).

| Parametro | Tipo | |
|---|---|---|
| `name` | testo | il nome o il path; senza estensione riceve `.canvas`; assente, il primo nome libero di «Lavagna», «Lavagna 1», … («Whiteboard» in inglese) |
| `folder` | testo | la cartella di un nome semplice (un path resta dov'è); se non c'è, nasce col file |

Un nome già preso è `AlreadyExists`, anche nell'anteprima, e niente si
sovrascrive; un nome con l'estensione di un altro formato, o che la regola dei
nomi nuovi rifiuta (caratteri riservati, nomi di Windows, un punto in testa o
in fondo), è `BadArgs` con la sua frase; un vault senza il formato delle
lavagne è `BadArgs`. Il testo è il sorgente nuovo di una lavagna vuota come lo
scrive il nucleo (R6: `{"nodes": [], "edges": []}` rientrato di due spazi e
chiuso da `"\n"`), riletto dal nucleo prima di scrivere. L'anteprima nomina il
file e non scrive; l'applicazione lo crea con `create_document` (che rifiuta
un path preso nel frattempo) e risponde con `Navigate`. L'annulla è
`note.trash` sul file: lo porta nel cestino anche se nel frattempo è cambiato,
e dal cestino si ripristina com'era quando la creazione è stata annullata.

## WebAssembly

La WebView usa lo stesso nucleo attraverso `fub-canvas-wasm`: un modulo
`wasm32-unknown-unknown` con un'interfaccia C scritta a mano, senza librerie
di collegamento, testo e JSON UTF-8 dentro e fuori. **Non è un contratto
pubblico**: lo usano solo il caricatore della shell,
`apps/client/src/editors/canvas/wasm/core.ts`, e il `.wasm`
fatto dagli stessi sorgenti nella stessa build; le due parti cambiano
insieme.

Il modulo si fa dalla libreria del crate, che nel manifesto resta `rlib`:

```sh
CARGO_TARGET_DIR=target/canvas-wasm CARGO_PROFILE_RELEASE_OPT_LEVEL=s \
CARGO_PROFILE_RELEASE_LTO=true CARGO_PROFILE_RELEASE_PANIC=abort \
CARGO_PROFILE_RELEASE_STRIP=true CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
cargo rustc -p fub-canvas-wasm --lib --release \
  --target wasm32-unknown-unknown --crate-type cdylib
```

Il modulo non importa niente ed esporta la sua `memory` e le funzioni qui
sotto. `src/api.rs` è il livello sicuro (una tabella di lavagne per handle),
`src/abi.rs` l'unico `unsafe`.

### Le funzioni

| Funzione | Ingresso | Esito | Risultato se riesce |
|---|---|---|---|
| `fub_alloc(len) -> ptr` | | 0 oltre il limite o senza memoria | |
| `fub_free(ptr, len)` | | | |
| `canvas_open(ptr, len) -> u32` | i byte del file | l'handle, 0 se fallisce | `{"handle", "canvas"}` |
| `canvas_reset(h, ptr, len) -> i32` | i byte del file | 0 o -1 | `{"canvas"}` |
| `canvas_commit(h, ptr, len) -> i32` | un array JSON di toppe | 0 o -1 | `{"edit", "inverse"}` |
| `canvas_preview(h, ptr, len) -> i32` | un array JSON di toppe | 0 o -1 | il sorgente intero, come testo |
| `canvas_compile(h, ptr, len) -> i32` | `{"ops", "seed"}` | 0 o -1 | `{"patches", "created"}` |
| `canvas_model(h) -> i32` | | 0 o -1 | `{"canvas"}` |
| `canvas_node_at(h, byte) -> i32` | | l'indice, -1 fuori da ogni scheda, -2 se fallisce | vuoto |
| `canvas_close(h) -> i32` | | 0 o -1 | vuoto |
| `result_ptr() -> ptr`, `result_len() -> len` | | | dove sta il risultato |

- `canvas_open` e `canvas_reset` prendono i byte del file così come sono,
  BOM e terminatori compresi, non una stringa JSON: il sorgente è il file.
  `canvas` è il modello con le chiavi nell'ordine in cui si scrivono
  (`nodes` ed `edges` ci sono sempre). Con un errore `canvas_reset` lascia la
  lavagna com'era.
- `canvas_commit` fa il commit delle toppe (le stesse di questa pagina, tutte
  o nessuna). `edit` è il tratto cambiato `{"start", "end", "text"}` in
  **unità UTF-16 del sorgente di prima**: `prima.slice(0, start) + text +
  prima.slice(end)` è il sorgente nuovo, e il tratto non taglia mai una
  coppia di surrogati. Non porta il sorgente intero, che con un file grande
  costerebbe a ogni gesto. `inverse` sono le toppe dell'annulla, da dare a un
  altro `canvas_commit`.
- `canvas_preview` dà il sorgente che darebbe `canvas_commit` con le stesse
  toppe, o lo stesso errore, e non cambia la lavagna: serve alle bozze, che
  vogliono il testo intero.
- `canvas_compile` compila le operazioni d'intento sul modello della lavagna,
  senza cambiarla. `seed` è facoltativo (0 se manca), un intero da 0 a
  2⁶⁴ − 1 come numero o come stringa di cifre decimali, perché un numero di
  JavaScript non è esatto oltre 2⁵³.
- `canvas_node_at` dà l'indice della scheda il cui oggetto nel sorgente
  contiene il byte `byte`, contato in UTF-8 dall'inizio del testo, BOM
  compreso.
- Gli handle partono da 1, crescono e non si riusano: 0 e `u32::MAX` non sono
  mai handle, e un handle chiuso risponde `handle` per sempre.

### Gli errori

Una funzione che fallisce mette nel risultato
`{"error": {"code", "message"}}`; `message` è la frase in inglese del nucleo,
per chi indaga e non per l'utente.

| `code` | Quando |
|---|---|
| `handle` | l'handle non è di una lavagna aperta |
| `utf8` | l'ingresso non è UTF-8 (anche un surrogato codificato) |
| `limit` | l'ingresso passa il limite d'ingresso, il sorgente passa `MAX_SOURCE_BYTES`, o gli handle sono finiti |
| `request` | il JSON non si legge o ha la forma sbagliata; un puntatore nullo con una lunghezza non zero |
| `source` | i byte non sono una lavagna (le regole del [formato](canvas-format.md)) |
| `stale`, `invalid`, `rejected`, `unstable` | il commit non si fa: la ragione di [Gli errori](#gli-errori) |
| `op` | un'operazione non si compila; in più `kind`, `index` e, se c'è, `id`, come nei vettori |
| `internal` | il modello non si scrive come JSON (non succede con un modello del nucleo) |

### La memoria

- **Chi alloca e chi libera.** Il chiamante chiede `len` byte a `fub_alloc`,
  ci scrive l'ingresso, chiama la funzione con `(ptr, len)` e poi libera lui
  con `fub_free(ptr, len)`, anche se la chiamata è fallita: il modulo non
  tiene mai un ingresso. `len` zero è un ingresso vuoto con qualunque
  puntatore, anche nullo; `fub_alloc(0)` dà un puntatore non nullo che non si
  legge, e `fub_free` con `len` zero o un puntatore nullo non fa niente.
- **Quanto vive il risultato.** Il risultato è del modulo: `result_ptr` e
  `result_len` lo descrivono fino alla chiamata dopo, che può spostarlo o far
  crescere la memoria. Il chiamante lo copia subito e rilegge le viste della
  memoria dopo ogni chiamata.
- **I limiti.** Il limite d'ingresso è `MAX_INPUT_BYTES` = 32 MiB, il doppio
  di `MAX_SOURCE_BYTES` (16 MiB): un sorgente di un byte oltre
  `MAX_SOURCE_BYTES` arriva al nucleo e risponde `limit`, e una lista di
  toppe ha posto per le immagini di prima e di dopo di una scheda con 1 MiB
  di testo scritto come stringa JSON. Un `fub_alloc` oltre il limite dà 0,
  e una chiamata con un `len` oltre il limite risponde `limit` senza leggere.
- **Una trappola.** Il nucleo non va in panico su un input: ogni errore è un
  `code`. Un panico che restasse (un difetto) o la memoria che finisce
  mentre si scrive una risposta sono una trappola WebAssembly (`panic =
  abort`): l'istanza non si usa più, le lavagne aperte si perdono, e il
  chiamante rifà l'istanza e riapre le lavagne dai loro testi.

I test sono in `crates/fub-canvas-wasm/tests/`: `api.rs` passa dal livello
sicuro, `abi.rs` dalle funzioni `extern "C"` chiamate in nativo, con gli
stessi controlli (ogni vettore di `canvas-patches/` e `canvas-ops/`, il
tratto UTF-16 con caratteri di uno, due, tre e quattro byte, BOM e CRLF, ogni
ingresso sbagliato, gli handle, 16 MiB e un byte in più, un risultato più
grande di 64 KiB) e, in `abi.rs`, la memoria viva uguale dopo 10 000 giri.

### Nella shell

Il plugin di Vite `apps/client/build/canvas-wasm.mjs`, in `vite.config.ts` e
in `vite.bench.config.ts`, fa il modulo con il comando qui sopra (più
`--locked`, con `CARGO_TARGET_DIR=target/canvas-wasm` dalla radice del
repository) e lo dà come modulo virtuale `virtual:fub-canvas-wasm`
(`canvasWasmHash`, `loadCanvasWasm()`):

- `npm run build` lo emette fra gli asset (`assets/fub-canvas-<hash>.wasm`) e
  ne stampa la dimensione; gli stessi sorgenti danno gli stessi byte.
- `npm run dev` lo serve da `__fub-canvas-wasm/<hash>.wasm`, guarda i
  sorgenti dei due crate, il loro `Cargo.toml` e `Cargo.lock`, e a ogni
  cambio rifà il modulo e ricarica la pagina.
- Sotto Vitest il modulo si compila una volta prima che partano i file di
  prova (`build/canvas-wasm.global-setup.mjs`), così una build fredda non
  scade dentro il tempo massimo di una prova; poi i byte si leggono dal file
  che cargo ha fatto.

Non c'è ripiego su un `.wasm` di prima: senza cargo o senza il target la
build si ferma, e l'errore dice che cosa installare (`rustup target add
wasm32-unknown-unknown`).

`core.ts` compila il modulo una volta e dà `openCore(testo)`, una
`CanvasCore` per lavagna con `model`, `reset`, `commit`, `preview`,
`compile`, `nodeAt` e `close`. Rilegge le viste della memoria dopo ogni
chiamata e libera ogni ingresso con `fub_free`, anche quando la chiamata
fallisce. Un testo con un surrogato spaiato è un errore `utf8` prima di
arrivare al modulo, mai un U+FFFD. Gli errori sono `CanvasCoreError` con i
`code` della tabella, più `trap` (l'istanza è morta: ogni lavagna aperta su
di lei risponde `trap`, e il prossimo `openCore` fa un'istanza nuova) e `load`
(il modulo non si carica; il prossimo `openCore` riprova). `close` si può
ripetere; dopo `close` ogni altra chiamata risponde `handle`. I test sono
`wasm/core.test.ts` e `wasm/vectors.test.ts`, sul `.wasm` vero.
