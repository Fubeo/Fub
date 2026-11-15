# Il controllo della lavagna

> **Ambito:** il controllo di una lista di operazioni prima di scriverla: i
> problemi, il riassunto di che cosa cambierebbe, gli avvisi sulle schede che la
> lista tocca e la lettura di dopo; il comando `canvas.check`; «Copia come
> codice», «Incolla codice» e «Disponi» nella lavagna.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/check.rs` (il controllo),
> `summary.rs` (il riassunto), i loro test in
> `crates/fub-canvas-core/tests/check.rs`, i vettori in
> `apps/client/src/__fixtures__/canvas-ops/`, e il comando in
> `crates/fub-features/src/lavagna/check.rs`; nella lavagna
> `apps/client/src/editors/canvas/engine.ts` e `code-text.ts`.

Questa pagina dice che cosa si legge di una lista prima di scriverla. Le
operazioni e la loro forma stanno in
[La lavagna come codice](canvas-code.md), il loro schema in
[Lo schema delle operazioni](canvas-schema.md); le toppe e il loro annulla in
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
| `warnings` | le note della compilazione e gli avvisi sulle schede che la lista tocca, `{code, ids, estimated_height?, index?, detail?}`: al più 100 |
| `warnings_omitted` | quanti avvisi non entrano in `warnings`: sempre presente, di solito `0`. Il conto è esatto |
| `summary` | che cosa cambia, come si legge sotto; `null` se `ok` è falso |
| `outline_after` | la lettura di dopo, come `outline`; `null` se `ok` è falso |

Con `ok: false` non c'è né riassunto né lettura: le operazioni valgono tutte o
nessuna.

**I codici della compilazione.** Si aggiungono a quelli dello
[schema](canvas-schema.md#i-problemi-di-forma). Il
`path` è il puntatore JSON all'id che non va, quando c'è.

| Codice | Quando | `suggestion` |
|---|---|---|
| `unknown_node` | `move`, `resize`, `reorder`, `align`, `distribute`, `duplicate`, `group`, `layout`, `convert`, il `near` di `insert` o un estremo di `connect`, con un id che non è una scheda | le schede col nome vicino |
| `unknown_edge` | `remove`, `set` o `color` con un id che non è né una scheda né un arco; `reverse` con un id che non è un arco | le schede e gli archi col nome vicino |
| `duplicate_id` | un id dato che c'è già, o ripetuto nella stessa operazione | per `from_mermaid` e `from_outline` un `prefix` con cui l'operazione si compila (`m1-`, `m2-`… o `s1-`…, al più venti prove) |
| `too_many`, `too_many_moved` | la lavagna avrebbe più di 100 000 schede o 200 000 archi, o un `insert` porta più di 10 000 schede, o un testo di `from_mermaid` o `from_outline` passa i suoi limiti, o un tratto di `draw` ha più di 10 000 punti; `too_many_moved` è un `move` con `contents` che tocca più di 1 000 schede | — |
| `invalid` | una scheda o un arco che il formato non accetta, col motivo in `message`; un tratto di `add_strokes` che non si disegnerebbe; un'operazione che la forma accetta e serde no, con la frase fissa `the operation does not match its schema` | — |
| `unknown_stroke` | `erase_strokes` con un id che non è un tratto del livello | — |
| `foreign_layer` | `add_strokes`, `erase_strokes` o `draw` su un livello d'inchiostro che Fub non legge (`path` è il suo `layer`, l'`on` di `draw`, o l'operazione intera per un `draw` senza `on` finito sulla radice) | — |

I nomi vicini sono quelli dello schema: distanza al più 2, maiuscole ASCII
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
- `strokes_added`, `strokes_removed`, `strokes_changed`: i tratti d'inchiostro
  nati, tolti o sostituiti, `{id, layer}`, col livello come nelle toppe
  (`"board"` o `{"node": id}`). Senza tratti i tre campi non ci sono.

**Gli avvisi.** Prima le note della compilazione (`Compiled::notes`: ciò che
un'operazione non ha potuto tenere, come la forma di un nodo Mermaid), nel loro
ordine, con `index` (l'operazione) e `detail`, e `ids` vuoto; le note che il
nucleo non tiene (`notes_omitted`) contano fra gli omessi. Poi gli avvisi sulle
schede che il giro tocca, nate o cambiate: una coppia
che nessuno tocca non compare, anche se si copre o il suo testo non ci sta.
Il rapporto ne porta al più 100 (`MAX_WARNINGS`), nell'ordine delle note, del
testo, delle coperture e dei gruppi. Gli altri si contano in `warnings_omitted`:
ogni coppia si conta una volta, e il conto è esatto. Con 2000 schede nello
stesso punto ci sono 1 999 000 coperture: il rapporto ne porta 100 e omette
1 998 900.

| Codice | Quando | `ids` |
|---|---|---|
| `overlap` | due schede che non sono gruppi hanno un'area in comune; un bordo che combacia non conta | le due |
| `half_in_group` | una scheda è in parte dentro un gruppo e in parte fuori | la scheda e il gruppo |
| `text_overflow` | il testo di una scheda di testo non ci sta nella sua altezza; `estimated_height` è quella che la stima di [«Misure e posti»](canvas-code.md#misure-e-posti) vuole | la scheda |
| `shape_dropped`, `style_dropped`, `line_skipped`, `indent_rounded` | le note di [`from_mermaid` e `from_outline`](canvas-import.md#le-note) | nessuna |
| `ink_kept` | la nota di [`erase_along`](canvas-ink-code.md#erase_along): un tratto che Fub non disegna, un tratto di pagina o di cella, o un livello estraneo, sotto il cammino non si taglia | nessuna |
| `pages_cut` | la nota di [`spread_pages`](canvas-pages-code.md#spread_pages): le pagine chieste oltre l'ultima del PDF si tagliano | nessuna |
| `page_size_not_file` | la nota di chi legge il PDF per `on` sulla pagina di [`draw` ed `erase_along`](canvas-ink-code.md#draw): il `page_size` dato differisce di più di mezzo punto da quello della pagina nel file, e vale quello dato | nessuna |
| `page_count_from_file` | la nota di chi legge il PDF per [`spread_pages` ed `excerpt`](canvas-pages-code.md) e per `on` sulla pagina di `draw` ed `erase_along`: il `page_count` dato non è quello del file, e vale quello del file | nessuna |

Un esempio, con la lavagna d'esempio di `spec.rs` (`t1`, `t2`, `f1`, il PDF `p1`, l'arco
`e1` e il tratto libero `s1`) e il giro `[{"op": "move", "ids": ["f1"], "dx": 0, "dy": -200}]`:

```json
{"ok": true, "problems": [], "warnings": [{"code": "overlap", "ids": ["t1", "f1"]}], "warnings_omitted": 0, "summary": {"cards_added": [], "cards_removed": [], "cards_changed": [{"id": "f1", "text": "schemi/acqua.png", "moved": {"from": {"x": 0, "y": 240}, "to": {"x": 0, "y": 40}}}], "edges_added": [], "edges_removed": [], "edges_changed": [], "order_changed": false}, "outline_after": "cards 4 edges 1 groups 0 bounds 0 0 1160×720\nink board 1 40 25 2.2×0.4\n1 t1 text \"Ciclo dell'acqua\" 0 0 320×160\n2 t2 text \"Evaporazione\" 400 0 320×160\n3 f1 image \"schemi/acqua.png\" 0 40 320×200\n4 p1 pdf \"schemi/dispensa.pdf\" 800 240 360×480\ne1 t1 -> t2 \"porta a\""}
```

Con `[{"op": "move", "ids": ["t9"], "dx": 40, "dy": 0}]` non si scrive, e il
rapporto dice perché:

```json
{"ok": false, "problems": [{"code": "unknown_node", "index": 0, "path": "/0/ids/0", "message": "there is no node with this id", "suggestion": "t1, t2"}], "warnings": [], "warnings_omitted": 0, "summary": null, "outline_after": null}
```

I test di `tests/check.rs` controllano un caso per codice e per avviso, i due
esempi qui sopra, e che `check` dia `ok` sui vettori di `canvas-ops/` se e solo
se `compile` si compila.

## Il comando

`canvas.check` («Controlla le operazioni», «Check the operations») dice che cosa
cambierebbe una lista di operazioni, prima di scriverla, e non scrive niente.
Ha i parametri di `canvas.apply`: `doc` e `ops` obbligatori, `base` e `seed`
facoltativi, con la stessa regola per il seme (di serie la revisione). Un
documento che non è una lavagna, un `.canvas` che non si apre e un `ops` che
non è JSON sono `BadArgs`, come in
[`canvas.apply`](canvas-operations.md#comandi); ogni altro difetto della lista è
un problema nel rapporto, e il comando riesce.

L'esito è l'effetto `Custom` con payload `{"version": 1, "kind": "check",
"ok", "problems", "warnings", "warnings_omitted", "summary",
"outline_after"}`. La forma del rapporto è quella descritta sopra, con due aggiunte. `warnings_omitted`
dice quanti avvisi non entrano nei primi cento. Ogni problema porta `text`, la
chiave del catalogo della sua frase (`canvas.check.p_<codice>`, in italiano e in
inglese): la frase la rende chi mostra il rapporto, e il payload resta
strutturato. Quando `base` non è la revisione del file, il rapporto ha in più il
problema `stale_base`, con indice `null` e percorso `""`: non è un errore, e il
rapporto non ha riassunto né lettura di dopo. La notifica è un riassunto per
chi legge: `canvas.check.n_summary` con i conti, o `canvas.check.n_refused` con
il numero dei problemi.

Con una lista che si scrive, un esempio è la lavagna di `a` alta 160 e della
scheda `b` nuova a fianco, con `a` spostata di 40 (il test
`controllare_dice_il_riassunto_e_non_scrive` lo fissa intero):

```json
{"version": 1, "kind": "check", "ok": true, "problems": [], "warnings": [{"code": "overlap", "ids": ["a", "b"]}], "warnings_omitted": 0, "summary": {"cards_added": [{"id": "b", "text": "Poi"}], "cards_removed": [], "cards_changed": [{"id": "a", "text": "Ciao", "moved": {"from": {"x": 0, "y": 0}, "to": {"x": 40, "y": 0}}}], "edges_added": [], "edges_removed": [], "edges_changed": [], "order_changed": false}, "outline_after": "cards 2 edges 0 groups 0 bounds 40 0 260×160\n1 a text \"Ciao\" 40 0 200×160\n2 b text \"Poi\" 100 0 200×160"}
```

Con una lista che non si scrive, `ok` è `false`, `summary` e `outline_after` sono
`null`, e ogni problema ha il suo codice, la posizione (`index`, da zero),
`path` e `text`, per esempio `{"code": "unknown_op", "index": 0, "path":
"/0/op", "message": "no operation has this name", "text": {"key":
"canvas.check.p_unknown_op"}}`. I codici sono quelli di questa pagina e
dello [schema](canvas-schema.md).

## Nella lavagna

Il menu del tasto destro su una scheda e quello sul vuoto hanno «Copia come
codice» (`canvas.copy_code`) e «Incolla codice» (`canvas.paste_code`): così un
pezzo di lavagna passa a un assistente, e le sue modifiche tornano.

- **Copia come codice** mette negli appunti, come testo, la lista che rifà le
  schede scelte e gli archi fra loro, o senza scelta la lavagna intera con
  l'inchiostro: la forma [`code`](canvas-code.md#il-codice) di `canvas.read`,
  da `canvas_describe` del modulo. Non scrive, e vale anche in sola lettura;
  su una lavagna vuota è spento. Le chiavi sconosciute della radice non ci
  sono: le porta solo la forma `json`.
- **Incolla codice** legge il primo `text/plain` degli appunti e lo dà a
  `canvas_check` col seme della tela. Appunti vuoti, un testo che non è JSON o
  non è una lista, e il primo problema (l'operazione contata da uno, il
  percorso, la frase e, se c'è, «Forse: …» col suggerimento) li dice l'avviso
  della tela, e niente cambia; una lista che non cambia niente lo dice allo
  stesso modo. Se no una finestra del kit dà il riassunto («1 scheda nuova,
  2 schede spostate») e il numero degli avvisi, e chiede: «Incolla» compila la
  lista con lo stesso seme, così gli id nati sono quelli del riassunto, la
  scrive in un passo d'annulla e sceglie le schede nate; «Annulla» ed Esc non
  scrivono. Se intanto la lavagna è cambiata, non scrive e lo dice. Un passo
  che porta la lavagna oltre il limite interattivo (2000 schede) si annulla lo
  stesso, e la lavagna torna interattiva. In sola lettura è spento.
- **Disponi** (`canvas.layout.grid`, `.row`, `.column`, `.tree`, nel
  sottomenu Disponi › di una scheda e del vuoto) scrive
  [`layout`](canvas-code.md#layout) sulle schede scelte o, senza scelta, su
  tutte quelle fuori dai gruppi. È spento con una scheda sola, su una lavagna
  con meno di due schede e in sola lettura.
