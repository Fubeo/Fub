# Gli estratti della lavagna

> **Ambito:** le schede che mostrano solo alcune parti di un file, cioè il
> campo `fub:parts` di una scheda `file` di un `.canvas`. Versione 1.
> **Fonti autorevoli:** questa pagina, i vettori in
> `apps/client/src/__fixtures__/canvas-parts/`,
> `crates/fub-canvas-core/src/parts.rs` e
> `apps/client/src/editors/canvas/parts.ts`.

Un **estratto** è una finestra sul file vero, non una copia: alcune pagine
di un PDF, un rettangolo di una pagina, alcune sezioni di una nota, un
ritaglio di un'immagine. Nel `.canvas` è una scheda `file` come le altre,
letta e scritta come dice il [formato della lavagna](canvas-format.md): il
`subpath` dice la prima parte, così Obsidian ne mostra almeno quella, e il
campo `fub:parts` le dice tutte. Il perché di questa forma sta nell'[ADR
0242](../decisions/0242-gli-estratti-sono-finestre.md).

## Esempio

Una scheda che mostra le pagine 3, 4, 5 e 8 di un PDF, una alla volta:

```json
{ "id": "e1", "type": "file", "file": "Libri/Statistica.pdf",
  "subpath": "#page=3", "x": 0, "y": 0, "width": 420, "height": 560,
  "fub:parts": { "kind": "pages", "pages": [3, 4, 5, 8], "layout": "one" } }
```

Obsidian mostra la pagina 3; Fub mostra le quattro pagine. Lo stesso caso è
il vettore `read-pages-four.json`.

## Le quattro specie

`fub:parts` è un oggetto con `kind`. I campi noti di ogni specie si
scrivono in quest'ordine, dopo `kind`; quelli che Fub non conosce vengono
dopo, nel loro ordine, e si conservano.

| `kind` | File | Campi | `subpath` |
|---|---|---|---|
| `pages` | PDF | `pages`, `layout` | `#page=` la prima pagina |
| `region` | PDF | `page`, `rect`, `key` | `#page=` la sua pagina |
| `sections` | nota | `sections` | `#` la prima sezione |
| `image` | immagine | `rect`, `rotate` | nessuno |

La specie del file si legge dall'estensione, in minuscolo, come la specie
della scheda ([Le schede della lavagna](canvas-cards.md)): `.pdf`; `.md` e
`.markdown`; `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`,
`.ico`, `.avif`, `.heic`, `.tif` e `.tiff`.

### `pages`

```json
{ "kind": "pages", "pages": [3, 4, 5, 8], "layout": "one" }
```

- `pages`: le pagine da 1, nell'ordine in cui si sono scelte (non per
  forza crescente), senza doppioni. Fub ne legge quante ce ne sono e ne
  scrive al più 1000.
- `layout`, facoltativo: `one` (una alla volta), `row` (in fila) o
  `column` (in colonna). Se manca vale la regola di serie: una pagina sola,
  grande; fino a tre in fila; da quattro in su una alla volta.

### `region`

```json
{ "kind": "region", "page": 7, "rect": [0.1, 0.306, 0.8, 0.141], "key": "p4:9f2c" }
```

- `page`: la pagina, da 1.
- `rect`: `[x, y, larghezza, altezza]` in frazioni della pagina come si
  vede, dall'angolo in alto a sinistra. I lati sono positivi e il
  rettangolo sta in 0…1; per gli errori d'arrotondamento può uscirne di al
  più 1e-6 (`[0.2, 0, 0.8000001, 1.0000001]` vale).
- `key`, facoltativo: una stringa, l'impronta della pagina, che servirà a
  ritrovare la regione quando il PDF cambia.

### `sections`

```json
{ "kind": "sections", "sections": ["Varianza", "Media"] }
```

- `sections`: le sezioni di una nota, stringhe non vuote e senza doppioni,
  ognuna come Obsidian la scrive dopo il `#`, anche con il percorso dei
  titoli (`Capitolo 2#Varianza`).

### `image`

```json
{ "kind": "image", "rect": [0, 0.25, 1, 0.5], "rotate": 90 }
```

- `rect`: come in `region`, in frazioni dell'immagine come si vede.
- `rotate`, facoltativo: gradi in senso orario, di serie 0. Fub legge
  qualsiasi numero e scrive solo 90, 180 o 270.

## Lettura

Leggere non cambia il file. Le regole valgono nell'ordine in cui sono
scritte, e la prima che non vale dà la ragione:

1. **La scheda è di tipo `file`.** Su una scheda di testo, di link o su un
   gruppo il campo si conserva e si ignora (`node`).
2. **Il campo è un oggetto** (`object`): `null`, un array o un numero si
   conservano.
3. **`kind` è una delle quattro specie** (`kind`). Una specie che Fub non
   conosce, come un `"cells"` scritto da una versione futura, si conserva.
4. **La specie va bene per il file** (`file`): `image` su un PDF non vale.
5. **I campi noti valgono** (`field`): una pagina non intera o minore di 1,
   una pagina o una sezione doppia, un `rect` fuori da 0…1 o con un lato non
   positivo, una lista vuota, un `layout` sconosciuto, una `key` o una
   `rotate` del tipo sbagliato. Un numero vale per il suo valore: `3.0` è la
   pagina 3.
6. **Il `subpath` è quello che la prima parte darebbe** (`subpath`). Se
   qualcuno l'ha cambiato o tolto fuori da Fub, vince lui.

Se una regola non vale, la scheda mostra ciò che dice il `subpath`, come
Obsidian, e `fub:parts` resta nel file byte per byte finché non si scelgono
di nuovo le parti. Spostare o ridimensionare la scheda non lo tocca.

Nel codice la lettura è `node_parts` e `read_parts` nel nucleo,
`nodeParts`, `readParts` e `cardParts` nella shell. Il renderer di una
scheda riceve le parti valide in `CardContext.parts`.

## Scrittura

Quando si scelgono le parti, Fub scrive il `subpath` della prima parte e il
campo, con le regole della lettura e due in più: al più 1000 pagine, e una
rotazione multipla di 90 gradi, riportata fra 0 e 270 (`-90` si scrive
`270`, un giro intero non si scrive). Un estratto che il `subpath` dice già
tutto non scrive `fub:parts`: una pagina sola, una sezione sola,
un'immagine intera e dritta.

I numeri si scrivono come li scrive JavaScript (`1e-7`,
`0.30000000000000004`, `2.50` riscritto è `2.5`), le chiavi nell'ordine di
sopra; una chiave sconosciuta che sembra un indice (`"1"`) va prima, come
in un oggetto JavaScript. Nel nucleo è `write_parts`, nella shell
`writeParts`; i due danno gli stessi byte.

## Che cosa vede Obsidian

Obsidian conosce il `subpath` e non `fub:parts`, che per lui è un campo
sconosciuto. Vede la prima pagina di `pages`, la pagina intera di
`region`, la prima sezione di `sections` e l'immagine intera di `image`.

## Come cresce

La versione 1 ha quattro specie. Le prossime, come i blocchi `^id` di una
nota, i fogli di una cartella di calcolo e le pagine web, sono specie nuove
con un `kind` nuovo: una versione di Fub che non le conosce le conserva e
mostra il `subpath`. Un campo nuovo di una specie che c'è va dopo quelli
noti, e chi non lo conosce lo conserva.

## I vettori

I vettori stanno in `apps/client/src/__fixtures__/canvas-parts/`, un caso
per file, scritti a mano. `crates/fub-canvas-core/tests/parts_vectors.rs` e
`apps/client/src/editors/canvas/parts.test.ts` li fanno girare tutti e due.

- `read-*.json`: `source`, il testo di una lavagna, ed `expect.cards`: per
  ogni scheda col campo, nell'ordine di `nodes`, `node`, `state` (`ok` o
  `kept`), `reason` se è `kept`, `parts` (il campo riscritto come
  `JSON.stringify`) e `layout` (quello che vale, per `pages`) se è `ok`, e
  `shows`, il `subpath` che la scheda mostra. Su ogni vettore i test
  provano anche che il campo riscritto dà gli stessi byte e che spostare la
  scheda non tocca il suo `fub:parts`.
- `write-*.json`: `file`, `parts` (le parti scelte) ed `expect`:
  `{"outcome": "written", "subpath": …, "parts": …}`, con `parts` come
  `JSON.stringify` o `null`, oppure `{"outcome": "refused", "reason": …}`
  con `file`, `field`, `pages` o `rotate`.

Un vettore che non passa si corregge nel lettore, non nel vettore.
