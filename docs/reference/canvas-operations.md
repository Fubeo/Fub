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
> `apps/client/src/__fixtures__/canvas-ops/` e la tela in
> `apps/client/src/editors/canvas/operation.ts`.

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
| `upsert-edge` | l'arco com'era, o `null` | l'arco nuovo | no |
| `remove-edge` | l'arco com'era | `null` | no |
| `reorder` | gli id delle schede, in ordine | gli stessi, nel nuovo ordine | no |

`at` è una posizione nella lista delle schede, che è anche la profondità: la
prima scheda sta sotto tutte le altre.

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

Un arco nuovo va in fondo alla lista degli archi. Le due schede che collega
devono esserci, anche se sono nuove nella stessa lista di toppe.

```json
{ "kind": "upsert-edge", "before": null,
  "after": { "id": "e1", "fromNode": "n1", "toNode": "n2", "toEnd": "arrow" } }
```

```json
{ "kind": "remove-edge",
  "before": { "id": "e1", "fromNode": "n1", "toNode": "n2", "toEnd": "arrow" },
  "after": null }
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
| `AtOutOfRange` | `at` oltre la fine della lista delle schede |
| `NodeHasEdges` | si toglie una scheda che ha ancora un arco |
| `MissingEndpoint` | un arco collega una scheda che non c'è |
| `NotAPermutation` | in `reorder`, `after` ha un id che non c'è, uno ripetuto o ne manca uno |

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
| `upsert-edge` con `before` uguale a `null` | `remove-edge` |
| `remove-edge` | `upsert-edge` con `before` uguale a `null` |
| `reorder` | `reorder` con `before` e `after` scambiati |

Gli `at` di una lista di `remove-node` sono le posizioni nel modello di
partenza. Per questo l'inversa riordina le schede da rimettere che stanno
vicine nella lista: prima l'`at` più basso, quelle senza `at` per ultime. Così
ogni scheda torna al suo posto.

```json
[{ "kind": "remove-node", "before": { "id": "b", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "b" }, "after": null, "at": 1 },
 { "kind": "remove-node", "before": { "id": "a", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "a" }, "after": null, "at": 0 }]
```

L'inversa rimette prima `a` in 0, poi `b` in 1.

Due cose non tornano al loro posto. Una scheda tolta senza `at` torna in
cima. Un arco tolto torna in fondo alla lista degli archi: le toppe degli
archi non hanno `at`, e l'ordine degli archi non si vede sulla tela.

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
di `remove-node` di cui fa parte, anche se la serie viene da più
operazioni: così l'inversa rimette ogni scheda al suo posto.

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
ordine, gli id di ogni scheda e arco aggiunti, dati o generati.

### Gli errori delle operazioni

Ogni errore (`OpError`) dice quale operazione della lista non si compila
(`index`, da zero).

| Errore | Quando |
|---|---|
| `UnknownNode` | `move`, `resize` o `reorder` di un id che non è una scheda; un arco verso una scheda che non c'è |
| `UnknownEdge` | `remove` o `set` di un id che non è né una scheda né un arco |
| `DuplicateId` | un id dato che è già preso; un id ripetuto nella lista di `move`, `remove` o `reorder` |
| `TooMany` | la lavagna avrebbe più di 100 000 schede o 200 000 archi |
| `Invalid` | una scheda o un arco che il formato non accetta; `set` di `id` o `type`; un id che è sia una scheda sia un arco |

I vettori stanno in `apps/client/src/__fixtures__/canvas-ops/`, uno per file,
scritti a mano: `before`, `seed` facoltativo (0 se manca), `ops` e `expect`
con `outcome` (`applied`, `rejected` o `malformed`) e, secondo il caso,
`after`, `created` ed `error`. `crates/fub-canvas-core/tests/op_vectors.rs` li
fa girare e controlla anche che l'inversa delle toppe ridia `before`.

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
