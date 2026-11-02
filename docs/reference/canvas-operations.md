# Operazioni sulla lavagna

> **Ambito:** le toppe che cambiano il modello di una lavagna, i loro errori
> e la loro inversa per l'annulla.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/patch.rs`, i suoi test in
> `crates/fub-canvas-core/tests/patch.rs` e la tela in
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
