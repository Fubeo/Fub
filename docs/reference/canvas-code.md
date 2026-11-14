# La lavagna come codice

> **Ambito:** la lavagna come codice: le tre letture di una lavagna (`outline`,
> `code`, `json`), le misure e i posti che il nucleo decide per una scheda, le
> operazioni d'intento con cui una lavagna si scrive, il loro schema, e il
> controllo che dice che cosa cambierebbe prima di scriverle.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/describe.rs` (le letture),
> `crates/fub-canvas-core/src/layout.rs` (misure e posti),
> `crates/fub-canvas-core/src/ops.rs` (le operazioni),
> `crates/fub-canvas-core/src/spec.rs` (lo schema e la forma),
> `crates/fub-canvas-core/src/check.rs` e `summary.rs` (il controllo e il
> riassunto), i loro test in `crates/fub-canvas-core/tests/describe.rs`,
> `layout_vectors.rs`, `op_vectors.rs`, `spec.rs` e `check.rs`, e i vettori in
> `apps/client/src/__fixtures__/canvas-layout.json`, `canvas-ops/` e
> `canvas-read/`.

Questa pagina dice come una lavagna si legge come codice e come si scrive.
Il modello e le regole di lettura e scrittura del file stanno nel
[formato della lavagna](canvas-format.md); le toppe e il loro annulla stanno
nelle [operazioni sulla lavagna](canvas-operations.md).

## La forma

Una lavagna in codice è una **lista di operazioni JSON**, la stessa che
accetta `canvas.apply`. Una persona e un modello scrivono la lavagna con le
stesse parole che userebbero per fare un gesto (aggiungi una scheda, collega,
togli), e il nucleo fa il resto con le sue regole.

Ho confrontato i candidati. Il motivo della scelta è nella seconda colonna.

| Candidato | Come va con un modello | Esito |
|---|---|---|
| JSON Canvas grezzo | lo sa scrivere, ma deve calcolare posti, misure, lati, id e la stringa `fub:ink` | resta possibile (`node`, `edge`, `set`) |
| scheletro con default, come `convertToExcalidrawElements` | scrive solo ciò che sceglie, il resto lo calcola il nucleo | sì: le forme brevi (vedi sotto) |
| operazioni d'intento | una riga per gesto (allinea, raggruppa, disegna): la stessa parola della GUI | sì: la lista di `canvas.apply` |
| un DSL di testo | un secondo linguaggio da imparare, da validare e da tenere allineato | no |
| Mermaid, scaletta | il modello li conosce, ma descrivono solo nodi e archi | sì, come import (non ancora) |
| uno script TS/JS | un motore da eseguire nel nucleo, con la sicurezza e il determinismo che costano | no |

Le forme brevi (una scheda senza coordinate, un arco che nomina le schede per
id) non ci sono ancora: finché non ci sono, una scheda si scrive con `x`, `y`,
`width` e `height`.

Le regole della forma:

- **Un solo padrone.** Le regole stanno in `fub-canvas-core`. Le letture e
  le operazioni le usano allo stesso modo: nessuna copia nella shell.
- **Gli argomenti sono ciò che una persona sceglie.** Il resto lo calcola il
  nucleo con la regola della GUI: misure di nascita, posti, lati, rettangolo
  del gruppo.
- **Si legge come si scrive.** `code` dà la lista che ricrea la lavagna:
  compilata su una lavagna vuota, dà la stessa lavagna (vedi
  [Il giro](#il-giro)).
- **Si aggiunge e basta.** Le operazioni e i campi che ci sono restano validi
  con lo stesso senso.
- **Tutte o nessuna, sempre deterministiche.** Lo stesso modello, le stesse
  operazioni e lo stesso seme danno gli stessi id e le stesse toppe.

### Prima e dopo

Una piccola mappa con le operazioni che la lavagna accetta. Ogni numero si
scrive a mano:

```json
[
  { "op": "add_card", "node": { "id": "a", "type": "text", "text": "Ciclo dell'acqua", "x": 0, "y": 0, "width": 320, "height": 160 } },
  { "op": "add_card", "node": { "id": "b", "type": "text", "text": "Evaporazione", "x": 368, "y": 0, "width": 320, "height": 160 } },
  { "op": "add_card", "node": { "id": "f", "type": "file", "file": "Scienze/nuvole.png", "x": 368, "y": 184, "width": 480, "height": 360 } },
  { "op": "connect", "edge": { "fromNode": "a", "toNode": "b", "fromSide": "right", "toSide": "left", "toEnd": "arrow" } },
  { "op": "set", "id": "b", "fields": { "color": "5" } }
]
```

## Leggere

Una lavagna si legge in tre forme. Le fa `fub_canvas_core::describe`, dal
modello validato, e non cambia il file. Tutte e tre prendono le stesse
[opzioni](#le-opzioni).

Per gli esempi questa è la lavagna:

```json
{
  "nodes": [
    { "id": "t1", "type": "text", "x": 0, "y": 0, "width": 320, "height": 160, "text": "Ciclo dell'acqua", "color": "5" },
    { "id": "t2", "type": "text", "x": 368, "y": 0, "width": 320, "height": 160, "text": "Evaporazione" },
    { "id": "f1", "type": "file", "file": "Scienze/nuvole.png", "x": 0, "y": 184, "width": 320, "height": 360 }
  ],
  "edges": [{ "id": "e1", "fromNode": "t1", "toNode": "t2", "toEnd": "arrow", "label": "usa" }]
}
```

### L'outline

`outline(&Canvas, &DescribeOptions) -> String` è il modo per leggere in fretta.
Dà una riga per conto: prima la riga dei conti, poi una riga per scheda e una
per arco.

```text
cards 3 edges 1 groups 0 bounds 0 0 688×544
1 t1 text "Ciclo dell'acqua" 0 0 320×160 color=5
2 t2 text "Evaporazione" 368 0 320×160
3 f1 image "Scienze/nuvole.png" 0 184 320×360
e1 t1 -> t2 "usa"
```

La riga dei conti dice quante schede (`cards`, i gruppi compresi), quanti
archi, quanti gruppi fra le schede, e il riquadro che racchiude le schede:
l'angolo alto a sinistra e la misura. Una lavagna vuota dice
`cards 0 edges 0 groups 0 bounds -`.

Una riga di scheda è `N id specie [testo] x y larghezza×altezza [color=…] [in=…]`:

- `N` è la posizione della scheda nel modello, da 1. Con `ids` resta quella del
  modello, così il numero corrisponde a quello della lettura intera.
- `specie` è il nome della specie: `text`, `note`, `document`, `sheet`, `pdf`,
  `image`, `web`, `craft`, `file` o `group`, come le dà la regola di
  [Misure e posti](#misure-e-posti).
- `testo` è il testo di una scheda di testo, l'etichetta di un gruppo, il
  percorso di un file con il suo sottopercorso (`#titolo`), l'indirizzo di un
  collegamento. È accorciato a 60 caratteri, il `…` compreso, e scritto come
  stringa JSON: un `"` o un a capo non spezzano la riga.
- `color=` c'è solo se la scheda ha un colore: `1`…`6` per i preset, il
  `#rrggbb` per l'esadecimale.
- `in=` c'è solo se la scheda sta dentro un gruppo: il gruppo più piccolo che
  la contiene, a parità di misura il primo del modello.

Una riga di arco è `id da -> a ["etichetta"] [color=…] [fromSide=…] [toSide=…] [fromEnd=arrow] [toEnd=none]`.
I lati e le punte compaiono solo quando non sono quelli di serie: nessun lato,
la punta alla fine (`toEnd` assente o `arrow`), nessuna punta in partenza.

Un id che ha solo lettere, cifre o `-_.:#` si scrive com'è. Un id con uno
spazio o un altro carattere si scrive come stringa JSON, così la riga resta
leggibile. Le chiavi sono i nomi dei campi del formato (`color`, `fromSide`,
`toEnd`): nessuna parola in una lingua.

### Il codice

`code(&Canvas, &DescribeOptions) -> Vec<CanvasOp>` dà la lista che ricrea la
lavagna: prima una `add_card` per scheda, nel suo ordine, poi una `connect`
per arco. Ogni scheda e ogni arco vanno in forma breve quando ogni campo ci sta
(`id`, `x` e `y` sempre; `width` e `height` solo se non sono quelle di nascita;
il colore con il suo nome); altrimenti sono il loro valore JSON del file, come
`node` o `edge`, con i campi sconosciuti dentro.

```json
[
  { "op": "add_card", "id": "t1", "text": "Ciclo dell'acqua", "x": 0, "y": 0, "color": "cyan" },
  { "op": "add_card", "id": "t2", "text": "Evaporazione", "x": 368, "y": 0 },
  { "op": "add_card", "id": "f1", "file": "Scienze/nuvole.png", "x": 0, "y": 184, "width": 320 },
  { "op": "connect", "id": "e1", "from": "t1", "to": "t2", "label": "usa" }
]
```

### Il modello

`json(&Canvas, &DescribeOptions) -> Result<Value, SourceError>` dà il modello
com'è, come lo scrive il file: `nodes` ed `edges` sempre, anche vuoti, poi la
radice sconosciuta. Con `ids` la radice sconosciuta non c'è, perché non è di
una scheda.

### Le opzioni

`DescribeOptions { ids, max_chars }` ha due campi, entrambi facoltativi:

- `ids` tiene quelle schede e gli archi che le collegano fra loro. Un id che non
  è una scheda si ignora, e i conti dicono quante schede ci sono davvero.
  Vale per le tre forme.
- `max_chars` taglia solo l'outline. Si taglia a righe intere, e l'ultima riga
  dice quante ne restano: `…+N`. La prima riga esce sempre, anche se da sola
  supera il limite. Il codice e il modello non si tagliano: una lista tagliata
  non si compila.

## Il giro

Compilato su una lavagna vuota (`compile`, con un seme qualunque), il codice
di una lavagna ridà la stessa lavagna: le stesse schede e gli stessi archi,
nello stesso ordine, con i campi sconosciuti. È la prova che `code` non perde
nulla, e `crates/fub-canvas-core/tests/describe.rs` la fa su ogni lavagna che
si apre nei vettori di `canvas-ops/` (prima e dopo l'operazione) e di
`canvas-read/`.

Il giro ha tre casi che non tornano uguali, e sono detti qui:

- **Lavagna vuota.** Nessuna operazione. Il modello è `{"nodes":[],"edges":[]}`.
- **Un id uguale su una scheda e su un arco.** Il formato lo ammette
  (`remove-ambiguous-id.json`), le operazioni no: un id è di una cosa sola.
  `code` lo dà comunque, e `compile` risponde `DuplicateId`. Il test ha questa
  lista esplicita.
- **La radice sconosciuta.** Un campo che il modello non conosce al livello del
  file (per esempio `"meta": [1, 2]` accanto a `nodes`) non sta in nessuna
  operazione. Lo dà [`json`](#il-modello). I campi sconosciuti di una scheda o di
  un arco, invece, sono dentro la loro operazione e il giro li conserva.

## Misure e posti

Le regole stanno in `crates/fub-canvas-core/src/layout.rs`, l'unico posto che
le decide. Il testo si misura con una stima fissa, non con i font: la stessa
lavagna dà gli stessi posti in Rust, in WebAssembly e da riga di comando. I
casi con i numeri stanno in `apps/client/src/__fixtures__/canvas-layout.json`.

- **Aggancio.** `snap(v) = floor(v / 8 + 0.5) * 8`: è `Math.round` di
  `engine.ts` con il passo di 8 (`CANVAS_SNAP`).
- **Specie.** Un testo è `text`, un gruppo è `group`, un collegamento è `web`.
  Un file prende l'estensione in minuscolo, senza il `#` e il sottopercorso:
  `md` e `markdown` sono `note`; `docx`, `doc`, `dot`, `rtf` e `odt` sono
  `document`; `xlsx`, `xlsm`, `xltx` e `xltm` sono `sheet`; `pdf` è `pdf`;
  `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `avif`, `heic`,
  `tif` e `tiff` sono `image`; tutto il resto, o nessuna estensione, è `file`.
  Un punto nelle cartelle non conta (`cartella.v2/nota` non ha estensione), e
  un punto in testa al nome non apre un'estensione (`.md` è `file`).
- **Misure di nascita.** Il testo è largo 320, o 480 se una riga ha più di 36
  caratteri, e alto quanto dice la stima qui sotto. `note` e `document` sono
  320×240; `sheet` 480×304; `pdf` 360 di larghezza, e alto `snap(360·h/w)` se
  si conosce la pagina, altrimenti 360×480. `image` ha il lato lungo a 480 e
  l'altro `snap(480·corto/lungo)`, o 480×360 se la misura non si conosce;
  `web` 320×120; `craft` e `file` 320×160; `group` 480×320. Un lato ricavato
  dalle proporzioni non scende sotto 40.
- **Stima del testo.** Ogni riga ha `cpl = max(8, floor((larghezza − 32) / 8))`
  caratteri. Le righe sono quelle separate da `\n` (o `\r\n`), e ognuna vale
  `max(1, ceil(caratteri / cpl))`, contando i punti di codice Unicode.
  L'altezza è `clamp(snap(24 · righe + 32), 160, 1600)`: il testo vuoto è alto
  160.
- **Posto automatico.** Su una lavagna vuota la scheda va in 0,0. Su una
  lavagna con schede va a 48 a destra della scheda più a destra, alla y della
  più alta. In una lista, una scheda senza posto va sotto la precedente scheda
  automatica a 24, con la sua x; se quella non c'è più nel modello, si riparte
  come sopra.
- **Vicino a.** Il lato di serie è `right`: a destra, a 48. `bottom` è a 24,
  `left` a 48, `top` a 24; `gap` cambia la distanza. A destra e a sinistra la y
  è quella di `near`; sopra e sotto la x è quella di `near`. Un testo sopra o
  sotto prende la larghezza di `near`. Se il posto tocca una scheda che non è un
  gruppo (né `near` stessa), la scheda scivola sull'asse perpendicolare, a 24 da
  quella toccata, al più 1000 passi; poi va oltre tutte le schede. Con una
  misura scritta a mano, il lato che tocca `near` resta a `gap`; lo scivolamento
  usa la misura di nascita. Un `near` che non c'è dà `None`, e lo dice chi chiama.
- **Dentro un gruppo.** Una scheda è dentro se il suo rettangolo sta tutto in
  quello del gruppo, bordi compresi. Una scheda non è dentro sé stessa.
- **Lati più vicini.** Si confrontano i centri. Se la distanza in orizzontale è
  almeno quella in verticale, il collegamento va da `right` a `left` (o da
  `left` a `right` se la seconda scheda sta a sinistra); se no, da `bottom` a
  `top` (o da `top` a `bottom`).
- **Gruppo attorno.** Il rettangolo che racchiude le schede, allargato del
  margine per lato, con ognuno dei quattro valori agganciato.

## Le operazioni

Un agente o la sessione dal tablet scrivono **operazioni d'intento**
(`CanvasOp`, in `crates/fub-canvas-core/src/ops.rs`), come «sposta» o
«collega», non toppe. `compile(canvas, ops, seed)` le traduce nelle
[toppe](canvas-operations.md#le-toppe) e dà `Compiled { patches, created }`.

Le operazioni si compilano in ordine, ognuna sul modello della precedente (si
può aggiungere una scheda e subito spostarla), e valgono tutte o nessuna. Il
modello di dopo resta valido, secondo il [formato](canvas-format.md).

Un'operazione è un oggetto JSON con il campo `op`. Un campo che l'operazione
non conosce, o un numero con una frazione vera dove serve un intero, è un
errore di lettura: un errore di battitura non diventa uno spostamento di zero.

### `add_card`

Aggiunge una scheda in cima all'ordine, in una di due forme che non si
mescolano. **Intera:** `node` è una scheda come nel file, campi sconosciuti
compresi; `id` dentro la scheda è facoltativo (assente o `null`: lo dà il seme).
**Breve:** `text` (testo, di serie vuoto), `file`, `url` (un collegamento) o
`label` (un gruppo, anche da solo) dicono il tipo; `type` (`text`, `file`,
`link`, `group`) lo dice se serve. `x` e `y` insieme danno il posto; `near`,
con `side` (di serie `right`) e `gap`, lo dà accanto a una scheda; senza
nessuno dei due va in fondo alla lista automatica. `width` e `height` sono
facoltativi, di serie quelli di nascita. Completano `id`, `color` (`red`…`purple`,
`note-grey`…`note-red`, `"1"`…`"6"` o `#rrggbb`), `subpath` e `content_size`
(`[w, h]`: i pixel di un'immagine, o i punti della prima pagina di un PDF).

```json
{ "op": "add_card", "text": "Nuova idea", "near": "t2", "side": "bottom", "color": "cyan" }
```

Un campo che non va col tipo, `x` senza `y`, un posto dato due volte, `side` o
`gap` senza `near`, o la forma intera mescolata con la breve, è `Invalid`, con
la frase che dice quale.

### `move`

Sposta le schede `ids` di `dx`, `dy`, con coordinate che saturano a ±(2^53−1).
Un gruppo si sposta da solo: le schede dentro restano dove sono. Con
`contents: true` il gruppo porta con sé le schede che ci stanno dentro (anche
quelle di un gruppo nel gruppo), una volta sola, fino a 1 000 schede toccate in
tutto (`TooManyMoved` oltre); su una scheda che non è un gruppo non fa niente.
Una lista vuota, o uno spostamento di zero, non dà toppe.

```json
{ "op": "move", "ids": ["g1"], "dx": 40, "dy": 0, "contents": true }
```

### `resize`

Dà alla scheda `id` le misure, almeno 1 (saturano a 2^53−1); `width` o `height`
da soli cambiano solo quella. Con `fit: "content"` la larghezza resta e l'altezza
viene dal contenuto: la stima di «Misure e posti» per un testo, le proporzioni di
un'immagine o di un PDF (`content_size`, o il file se si legge, fino a 32 MiB).
Una nota, un file o un gruppo non hanno misura: è `Invalid`.

```json
{ "op": "resize", "id": "f1", "fit": "content" }
```

### `connect`

Aggiunge un arco in fondo alla lista, in due forme. `edge` è un arco come nel
file (`id` facoltativo); `from` e `to` sono le due schede, che devono esserci, e
`id`, `label` e `color` sono come in `add_card`. `sides` è `"auto"` (i lati più
vicini) o `{from, to}`: di serie nessun lato. `ends` è `arrow` (di serie), `none`
o `both`. Un arco da una scheda a sé stessa va bene.

```json
{ "op": "connect", "from": "a", "to": "b", "sides": "auto", "label": "porta a" }
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
sconosciuto. `id`, e `type` di una scheda, non si cambiano. Il `color` accetta
i nomi di `add_card` e lo scrive come valore del file (`cyan` diventa `"5"`).

```json
{ "op": "set", "id": "a", "fields": { "color": "4", "text": "nuovo", "fub:tag": null } }
```

### `reorder`

Porta le schede `ids` in cima all'ordine, nell'ordine dato, o con `to: "back"` in
fondo, sotto le altre. Con tutti gli id, `ids` è l'ordine nuovo.

```json
{ "op": "reorder", "ids": ["b", "a"], "to": "back" }
```

### `color`

Colora più schede e archi in una volta: `color` è un nome come in `add_card`,
`"1"`…`"6"`, `#rrggbb`, o `null` che toglie il colore (il campo c'è sempre).

```json
{ "op": "color", "ids": ["t1", "t2", "e1"], "color": "cyan" }
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
Obsidian: col seme 0 il primo è `e220a8397b1dcdaf`. Un giro di `compile` salta
gli id presi (di schede, archi o del giro stesso); un id dato a mano, se è preso,
è `DuplicateId`. `created` dice gli id aggiunti, in ordine.

### Gli errori delle operazioni

Ogni errore (`OpError`) dice quale operazione della lista non si compila
(`index`, da zero).

| Errore | Quando |
|---|---|
| `UnknownNode` | `move`, `resize` o `reorder` di un id che non è una scheda; un arco verso una scheda che non c'è |
| `UnknownEdge` | `remove`, `set` o `color` di un id che non è né una scheda né un arco |
| `DuplicateId` | un id dato che è già preso; un id ripetuto nella lista di `move`, `remove`, `reorder` o `color` |
| `TooMany`, `TooManyMoved` | la lavagna avrebbe più di 100 000 schede o 200 000 archi; `TooManyMoved` è un `move` con `contents` che tocca più di 1 000 schede |
| `Invalid` | una scheda o un arco che il formato non accetta; una forma breve incompleta o mescolata con la intera; `set` di `id` o `type`; un `resize` senza misure o con `fit` e `height`; un id che è sia una scheda sia un arco |

I vettori stanno in `apps/client/src/__fixtures__/canvas-ops/`, uno per file
(`before`, `seed`, `ops`, `expect`); `tests/op_vectors.rs` li fa girare e
controlla che l'inversa delle toppe ridia `before`.

## Lo schema

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

**Lo schema JSON.** `json_schema()` dà lo schema JSON 2020-12 della lista: una
lista non vuota, e un `oneOf` con un ramo per operazione. Ogni ramo ha `op`
costante, `additionalProperties: false`, i campi obbligatori e gli esempi.

**I problemi di forma.** `validate` dà i problemi di una lista prima della
lettura, con `{code, index, path, message, suggestion?, fix?}`. Il controllo
(«Il controllo», più sotto) li riusa:

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
  numero; i tetti sono quelli di [`OpError`](#gli-errori-delle-operazioni).

Un esempio, con la lista `[{"op": "add-card"}]`:

```json
[{"code": "unknown_op", "index": 0, "path": "/0/op", "message": "no operation has this name", "suggestion": "add_card", "fix": {"op": "add_card"}}]
```

I test di `tests/spec.rs` controllano che `OPS` abbia una voce per variante, che
ogni esempio si legga e compili sulla lavagna d'esempio di `spec.rs`, che
`validate` non trovi problemi se e solo se serde legge la lista, sui vettori di
`canvas-ops/` e sul corpus `canvas-tasks/` quando c'è.

## Il controllo

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
| `unknown_node` | `move`, `resize`, `reorder`, o un estremo di `connect`, con un id che non è una scheda | le schede col nome vicino |
| `unknown_edge` | `remove` o `set` con un id che non è né una scheda né un arco | le schede e gli archi col nome vicino |
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
| `text_overflow` | il testo di una scheda di testo non ci sta nella sua altezza; `estimated_height` è quella che la stima di [«Misure e posti»](#misure-e-posti) vuole | la scheda |

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

