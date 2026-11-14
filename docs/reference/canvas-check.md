# Il controllo della lavagna

> **Ambito:** il controllo di una lista di operazioni prima di scriverla: i
> problemi, il riassunto di che cosa cambierebbe, gli avvisi sulle schede che la
> lista tocca e la lettura di dopo.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/check.rs` (il controllo),
> `summary.rs` (il riassunto), i loro test in
> `crates/fub-canvas-core/tests/check.rs`, e i vettori in
> `apps/client/src/__fixtures__/canvas-ops/`.

Questa pagina dice che cosa si legge di una lista prima di scriverla. Le
operazioni, la loro forma e il loro schema stanno in
[La lavagna come codice](canvas-code.md); le toppe e il loro annulla in
[le operazioni sulla lavagna](canvas-operations.md).

`check` dice che cosa cambierebbe una lista di operazioni prima di scriverla,
con gli avvisi che la GUI farebbe vedere a occhio. Sta in
`crates/fub-canvas-core/src/check.rs`. Fa i passi nell'ordine della scrittura:
la forma (`validate`), poi la lettura di serde, poi `compile`. Il rapporto ha
sei campi:

| Campo | Vuol dire |
|---|---|
| `ok` | la lista si scrive: non ci sono problemi |
| `problems` | i problemi, con la forma di quelli di `validate`; la compilazione si ferma al primo |
| `warnings` | gli avvisi sulle schede che la lista tocca, `{code, ids, estimated_height?}`: al più 100 |
| `warnings_omitted` | quanti avvisi non entrano in `warnings`: sempre presente, di solito `0`. Il conto è esatto |
| `summary` | che cosa cambia, come si legge sotto; `null` se `ok` è falso |
| `outline_after` | la lettura di dopo, come `outline`; `null` se `ok` è falso |

Con `ok: false` non c'è né riassunto né lettura: le operazioni valgono tutte o
nessuna.

**I codici della compilazione.** Si aggiungono a quelli di «Lo schema». Il
`path` è il puntatore JSON all'id che non va, quando c'è.

| Codice | Quando | `suggestion` |
|---|---|---|
| `unknown_node` | `move`, `resize`, `reorder`, `align`, `distribute`, `duplicate`, `group`, `layout`, o un estremo di `connect`, con un id che non è una scheda | le schede col nome vicino |
| `unknown_edge` | `remove`, `set` o `color` con un id che non è né una scheda né un arco; `reverse` con un id che non è un arco | le schede e gli archi col nome vicino |
| `duplicate_id` | un id dato che c'è già, o ripetuto nella stessa operazione | — |
| `too_many`, `too_many_moved` | la lavagna avrebbe più di 100 000 schede o 200 000 archi; `too_many_moved` è un `move` con `contents` che tocca più di 1 000 schede | — |
| `invalid` | una scheda o un arco che il formato non accetta, col motivo in `message`; un'operazione che la forma accetta e serde no, con la frase fissa `the operation does not match its schema` | — |

I nomi vicini sono quelli di «Lo schema»: distanza al più 2, maiuscole ASCII
ignorate (`T1` ha il vicino `t1`). Sono al più tre, alla distanza minima, nell'ordine
della lavagna. Gli errori della compilazione non hanno mai il `fix`: un id vicino
non è mai la correzione sicura.

**Il riassunto.** Si legge dalle toppe del giro, non da un confronto di due
lavagne: una scheda nata e tolta nello stesso giro non compare, e una scheda che
più operazioni cambiano compare una volta, con il saldo.

- `cards_added`, `cards_removed`: `{id, text?}`. `text` è il testo accorciato a
  60 caratteri, come nella lettura.
- `cards_changed`: `{id, text?, moved?, resized?, fields?}`. `moved` ha `from` e
  `to` come `{x, y}`; `resized` ha `from` e `to` come `{width, height}`; `fields`
  ha i nomi dei campi del file che cambiano (`color`, `text`…), senza posizione
  e misura.
- `edges_added`, `edges_removed`: `{id, fromNode, toNode}`; `edges_changed`:
  `{id, fromNode, toNode, fields}`.
- `order_changed`: se l'ordine delle schede rimaste è cambiato (un `reorder`).

**Gli avvisi.** Solo sulle schede che il giro tocca, nate o cambiate: una coppia
che nessuno tocca non compare, anche se si copre o il suo testo non ci sta.
Il rapporto ne porta al più 100 (`MAX_WARNINGS`), nell'ordine del testo, poi
delle coperture, poi dei gruppi. Gli altri si contano in `warnings_omitted`:
ogni coppia si conta una volta, e il conto è esatto. Con 2000 schede nello
stesso punto ci sono 1 999 000 coperture: il rapporto ne porta 100 e omette
1 998 900.

| Codice | Quando | `ids` |
|---|---|---|
| `overlap` | due schede che non sono gruppi hanno un'area in comune; un bordo che combacia non conta | le due |
| `half_in_group` | una scheda è in parte dentro un gruppo e in parte fuori | la scheda e il gruppo |
| `text_overflow` | il testo di una scheda di testo non ci sta nella sua altezza; `estimated_height` è quella che la stima di [«Misure e posti»](canvas-code.md#misure-e-posti) vuole | la scheda |

Un esempio, con la lavagna d'esempio di `spec.rs` (`t1`, `t2`, `f1` e l'arco
`e1`) e il giro `[{"op": "move", "ids": ["f1"], "dx": 0, "dy": -200}]`:

```json
{"ok": true, "problems": [], "warnings": [{"code": "overlap", "ids": ["t1", "f1"]}], "warnings_omitted": 0, "summary": {"cards_added": [], "cards_removed": [], "cards_changed": [{"id": "f1", "text": "schemi/acqua.png", "moved": {"from": {"x": 0, "y": 240}, "to": {"x": 0, "y": 40}}}], "edges_added": [], "edges_removed": [], "edges_changed": [], "order_changed": false}, "outline_after": "cards 3 edges 1 groups 0 bounds 0 0 720×240\n1 t1 text \"Ciclo dell'acqua\" 0 0 320×160\n2 t2 text \"Evaporazione\" 400 0 320×160\n3 f1 image \"schemi/acqua.png\" 0 40 320×200\ne1 t1 -> t2 \"porta a\""}
```

Con `[{"op": "move", "ids": ["t9"], "dx": 40, "dy": 0}]` non si scrive, e il
rapporto dice perché:

```json
{"ok": false, "problems": [{"code": "unknown_node", "index": 0, "path": "/0/ids/0", "message": "there is no node with this id", "suggestion": "t1, t2"}], "warnings": [], "warnings_omitted": 0, "summary": null, "outline_after": null}
```

I test di `tests/check.rs` controllano un caso per codice e per avviso, i due
esempi qui sopra, e che `check` dia `ok` sui vettori di `canvas-ops/` se e solo
se `compile` si compila.

