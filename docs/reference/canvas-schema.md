# Lo schema delle operazioni della lavagna

> **Ambito:** lo schema delle operazioni d'intento della lavagna: i campi e i
> loro tipi, lo schema JSON della lista e i problemi di forma (`validate`) prima
> della lettura.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/spec.rs` (lo schema e la
> forma), i suoi test in `crates/fub-canvas-core/tests/spec.rs`, e i vettori in
> `apps/client/src/__fixtures__/canvas-ops/` e `canvas-tasks/`.

Questa pagina dice come si descrive e si controlla la forma di una lista di
operazioni. Le operazioni e le loro regole stanno nella
[lavagna come codice](canvas-code.md#le-operazioni); il controllo di una lista
prima di scriverla sta in [Il controllo della lavagna](canvas-check.md).

## I campi

Lo schema sta nel nucleo, in `crates/fub-canvas-core/src/spec.rs`: `OPS` ha una
voce per operazione (nome, riepilogo, campi con tipo e obbligatorietà, esempi),
e coincide con serde campo per campo (`tests/spec.rs`). Un'operazione nuova
entra in `OPS` nello stesso task.

I tipi dei campi sono `id`, `ids` (una lista di id), `number` (un intero: anche
`1.0` e `1e2` lo sono, `1.5` no), `text`, `bool`, `enum` (una stringa presa da
un elenco), `node` (una scheda), `edge` (un arco), `color` (un nome, `"1"`…`"6"`
o `#rrggbb`, o `null`), `sides` (`"auto"` o `{from, to}`), `pair` (due numeri,
`[w, h]`), `object`, `patch` (i campi nuovi di `set`, col suo `color`), `points`
(una lista di liste di numeri) e `any`. Un campo facoltativo `null` vale come
assente, per la forma e per serde.

## Lo schema JSON

`json_schema()` dà lo schema JSON 2020-12 della lista: una
lista non vuota, e un `oneOf` con un ramo per operazione. Ogni ramo ha `op`
costante, `additionalProperties: false`, i campi obbligatori e gli esempi.

## I problemi di forma

`validate` dà i problemi di una lista prima della
lettura, con `{code, index, path, message, suggestion?, fix?}`. Il controllo
([Il controllo della lavagna](canvas-check.md)) li riusa:

| Campo | Vuol dire |
|---|---|
| `code` | il codice, nella tabella sotto |
| `index` | la posizione dell'operazione nella lista, da zero; `null` se il problema riguarda la lista intera |
| `path` | dove sta, come puntatore JSON (RFC 6901): `/2/dx` |
| `message` | una frase fissa in inglese, come gli errori di `OpError`; le frasi per le persone le fa il catalogo di `fub-features` |
| `suggestion` | il nome o i nomi più vicini, a distanza di Levenshtein al più 2 |
| `fix` | l'operazione intera con la correzione; c'è solo quando la correzione è una sola e il posto è libero |

| Codice | Quando | `message` |
|---|---|---|
| `invalid` | la lista è vuota. Serde la legge: è la sola differenza, voluta | `the list has no operations` |
| `unknown_op` | manca `op`, o il suo valore non è il nome di un'operazione | `no operation has this name` |
| `unknown_field` | un campo che l'operazione non ha | `the operation has no such field` |
| `missing_field` | un campo obbligatorio che manca | `a required field is missing` |
| `wrong_type` | un tipo JSON sbagliato. Vale anche per la lista che non è una lista, e per un'operazione che non è un oggetto | `the value has the wrong JSON type` |
| `bad_value` | un valore fuori dall'elenco ammesso | `the value is not one of the allowed values` |

Le regole:

- Un'operazione con il nome sbagliato non ha i suoi campi controllati: non si
  sa quali sono.
- I nomi vicini si cercano ignorando le maiuscole ASCII: `Add-Card` è vicino a
  `add_card`. Serde resta sensibile alle maiuscole, quindi il nome sbagliato non
  si legge, e il `fix` lo corregge.
- Il `fix` c'è solo se il vicino è uno, e se il campo corretto non è già
  nell'operazione: con `dx` già scritto, `dX` ha il suggerimento ma non il `fix`.
- Una stringa al posto di una lista di id ha il `fix` con la lista: `"ids": "t1"`
  diventa `"ids": ["t1"]`.
- Il `fix` corregge solo ciò che si sa correggere. Con `{"op": "add-card"}` il
  `fix` è `{"op": "add_card"}`: una scheda senza `node` né forma breve non si
  scrive, e la compilazione lo dice con `invalid` su `/0`.
- `validate` è lineare: 100 000 operazioni si controllano, senza tetto al loro
  numero; i tetti sono quelli di [`OpError`](canvas-code.md#gli-errori-delle-operazioni).

Un esempio, con la lista `[{"op": "add-card"}]`:

```json
[{"code": "unknown_op", "index": 0, "path": "/0/op", "message": "no operation has this name", "suggestion": "add_card", "fix": {"op": "add_card"}}]
```

I test di `tests/spec.rs` controllano che `OPS` abbia una voce per variante, che
ogni esempio si legga e compili sulla lavagna d'esempio di `spec.rs`, che
`validate` non trovi problemi se e solo se serde legge la lista, sui vettori di
`canvas-ops/` e sul corpus `canvas-tasks/` quando c'è.
