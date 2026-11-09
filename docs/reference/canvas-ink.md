# L'inchiostro della lavagna

> **Ambito:** i tratti a mano libera di una lavagna, cioè i campi `fub:ink`
> di un file `.canvas`. Versione 1.
> **Fonti autorevoli:** questa pagina e i vettori in
> `apps/client/src/__fixtures__/canvas-ink/`.

Come una lavagna tiene l'inchiostro scritto sopra le sue schede e sul vuoto.
Una lavagna è un file [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), lo
stesso di Obsidian, letto e scritto come dice il
[formato della lavagna](canvas-format.md); l'inchiostro sta in campi in più, che un programma che non
li conosce conserva o ignora. I punti di un tratto si scrivono con la stringa
`fub:ink` dei disegni e il pennello con la grammatica di `fub:brush`
([formato della scena](scene-format.md), §5). Il perché di questa forma sta
nell'[ADR 0241](../decisions/0241-inchiostro-sulla-lavagna.md).

## Esempio completo

Una lavagna con una scheda file annotata, una scheda di testo e un tratto
libero sul vuoto:

```json
{
  "nodes": [
    { "id": "f1", "type": "file", "file": "Corsi/Statistica/voti.xlsx",
      "x": 0, "y": 0, "width": 640, "height": 420,
      "fub:ink": { "v": 1, "strokes": [
        { "id": "s-mh0k2q1x-4f9a-1", "tool": "pen",
          "at": "2026-11-02T09:20:31.250Z",
          "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
          "color": "#0072b2",
          "anchor": { "kind": "card", "width": 640, "height": 420 },
          "ink": "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8" } ] } },
    { "id": "n2", "type": "text", "text": "Perché la media è così bassa?",
      "x": 700, "y": 40, "width": 280, "height": 90 }
  ],
  "edges": [],
  "fub:ink": { "v": 1, "strokes": [
    { "id": "s-mh0k2r7c-0b1e-2", "tool": "pen",
      "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
      "color": "#0072b2", "anchor": { "kind": "free" },
      "ink": "1 s100 cxy 4000,2500 120,40 95,-10" } ] }
}
```

Il primo tratto è della scheda `f1`: comincia a 120,5 e 30,2 unità dal suo
angolo in alto a sinistra, misurate quando la scheda era 640 × 420. Il secondo
è libero: comincia al punto 40, 25 della lavagna. La scheda `n2` non ha
inchiostro e non ha il campo. Lo stesso file è il vettore `board-and-card.json`.

## Il livello

Un **livello** è l'oggetto sotto la chiave `fub:ink`:

- di una scheda, di qualunque tipo (`text`, `file`, `link`, `group`): i tratti
  di quella scheda;
- della radice del file: i tratti liberi, in coordinate della lavagna.

```json
{ "v": 1, "strokes": [ … ] }
```

- **`v`:** la versione del livello, il numero 1. Si confronta per valore:
  `1.0` è 1.
- **`strokes`:** l'array dei tratti, nell'ordine in cui si disegnano: l'ultimo
  sta sopra.
- **Altri campi:** si conservano dove sono e non cambiano il significato del
  livello.
- **Un gruppo è una scheda.** Il suo livello tiene i tratti scritti sul suo
  vuoto. Un figlio sta sopra il gruppo nell'ordine di `nodes` e ha il suo
  livello: il gruppo non contiene i tratti dei figli.
- **Un `fub:ink` su un arco, o dentro un tratto,** è un campo sconosciuto come
  gli altri: non è un livello e non si disegna.

## Il tratto

| Campo | Obbligatorio | Valore |
|---|---|---|
| `id` | sì | stringa non vuota, unica nel livello |
| `tool` | sì | `"pen"` o `"highlighter"` |
| `at` | no | istante d'inizio, ISO 8601 UTC coi millisecondi, come `fub:at` (formato della scena, §5) |
| `brush` | sì | il pennello, con la grammatica di `fub:brush` (`pf1` o `nib1`) e la penna in `pen=<id>` |
| `color` | sì | `#rrggbb`, sei cifre esadecimali, maiuscole o minuscole |
| `anchor` | sì | l'ancora, qui sotto |
| `ink` | sì | i campioni, con la grammatica di `fub:ink` (formato della scena, §5) |

- **`id`:** unico nel livello, non nella lavagna. Duplicare una scheda copia il
  suo livello con gli stessi id. Fub crea gli id nuovi come quelli delle
  schede, col prefisso `s` (`newNodeId("s")` in
  `apps/client/src/editors/canvas/operation.ts`).
- **`at`:** non decide mai se il tratto si disegna. Un valore che non è una
  data, o non è una stringa, si conserva com'è.
- **`brush`:** lo spessore (`size`) e le rastremazioni sono in unità
  dell'ancora: della scheda alla sua misura di riferimento, o della lavagna.
  Le penne con un nome stanno nel
  [formato della scena, penne e punta piatta](scene-format-pens.md).
- **`color`:** il riempimento del tratto. Si scrive come attributo `fill`,
  mai come variabile del tema: il colore è un dato del file. La forma corta
  a tre cifre (`#07b`) e il canale alfa non valgono.
- **`ink`:** i campioni `x`, `y` sono in unità dell'ancora, moltiplicati per
  la scala. I canali facoltativi (`p`, `t`, `a`, `z`) e la quantizzazione
  sono quelli della §5. Un canale sconosciuto rende il tratto non
  disegnabile: la lavagna non ha un `d` già calcolato da usare al suo posto.
- **Campi sconosciuti:** si conservano nell'ordine in cui erano.

## L'ancora

L'ancora dice in quali unità sono i punti del tratto.

| Ancora | Dove vale | I punti |
|---|---|---|
| `{"kind": "card", "width": W, "height": H}` | solo nel livello di una scheda | unità della scheda alla misura `W × H`, origine nell'angolo in alto a sinistra |
| `{"kind": "free"}` | solo nel livello della radice | coordinate della lavagna |

- **`W`, `H`:** la misura della scheda quando il tratto si è scritto, numeri
  finiti maggiori di zero. Dicono in che unità sono i punti; come seguono la
  misura di adesso lo dice «La misura della scheda». Si confrontano per valore: `640.0` e `6.4e2` sono
  640.
- **Fuori posto:** un'ancora `card` alla radice o `free` su una scheda non è
  valida, e il tratto non si disegna.
- **Altri campi dell'ancora:** si conservano dopo quelli noti e non cambiano
  il significato.

## Come si disegna

- **L'inchiostro di una scheda** si disegna sopra il suo contenuto, con la
  scheda: una scheda che le sta sopra nell'ordine di `nodes` lo copre.
- **L'inchiostro libero** si disegna sopra tutte le schede.
- **Spostare una scheda** non cambia niente nel file: i punti sono relativi
  alla scheda.
- **Ridimensionare una scheda** non cambia niente nel file. Come la resa
  porta il tratto da `W × H` alla misura di adesso `w × h` dipende dalla
  scheda (sotto, «La misura della scheda»).
- **Un tratto che esce dalla scheda** resta valido: i punti non hanno limiti
  di posizione, e ciò che esce si vede, non si taglia.

### La misura della scheda

Ogni scheda ha un **modo**, che si legge dal tipo e dal nome del file, mai dai
tratti:

| Modo | Schede | Il punto (x, y) va a | Spessore |
|---|---|---|---|
| `scale` | `file` il cui file è un'immagine o un PDF | (dx + s · x, dy + s · y) | per `s` |
| `fixed` | tutte le altre: `file` di altro tipo o senza estensione, `text`, `link`, `group` | (x, y) | com'è |

- **Con `scale`** l'inchiostro scala senza deformarsi e si centra nella
  scheda: `s = min(w / W, h / H)`, `dx = (w − W · s) / 2`,
  `dy = (h − H · s) / 2`. È ciò che fa SVG con `viewBox="0 0 W H"` e
  `preserveAspectRatio="xMidYMid meet"` su un riquadro `w × h`.
- **Con `fixed`** l'inchiostro resta alla misura in cui è stato scritto,
  nell'angolo in alto a sinistra, qualunque sia la misura di adesso.
- **Immagine e PDF** si riconoscono dall'estensione del campo `file`, senza
  distinguere maiuscole: è l'ultima parte del nome dopo un punto, e un nome
  come `.png` non ne ha. Immagini: `png`, `jpg`, `jpeg`, `gif`, `webp`,
  `svg`, `bmp`, `ico`, `avif`, `heic`, `tif`, `tiff`; PDF: `pdf`. Il
  `subpath` non conta. Conta il tipo: una scheda `text` con un campo `file`
  è `fixed`.
- **Misure senza senso:** una scheda larga o alta zero dà `s = 0` e il tratto
  non si vede; una misura non finita o negativa, o una misura di riferimento
  che non vale, dà `s = 0`, `dx = dy = 0`. Mai `NaN`.
- **Rinominare il file** (da `.png` a `.md`) cambia il modo, non il file.
  Ridimensionare a un'altra proporzione e tornare rimette l'inchiostro
  com'era.
- Un gruppo è `fixed` anche quando contiene immagini; ogni immagine dentro di
  lui segue il proprio modo.

I vettori stanno in `apps/client/src/__fixtures__/canvas-ink-fit/`, un caso
per file, scritti a mano: `name`, `description`, la scheda (`card`, con
`type` e `file`), `ref` (`W`, `H`), `size` (`w`, `h`) e in `expect` il modo,
`s`, `x` (`dx`), `y` (`dy`) e qualche punto `from` → `to`.

## Il livello estraneo

Un livello è **estraneo** quando:

- `fub:ink` non è un oggetto;
- `v` manca o non vale 1;
- `strokes` manca o non è un array;
- un elemento di `strokes` non è un oggetto o non ha un `id` stringa non
  vuota;
- due tratti hanno lo stesso `id`.

Un livello estraneo si conserva byte per byte, non si disegna e Fub non ci
scrive. I suoi tratti non si elencano, neanche quelli validi. La penna su una
scheda col livello estraneo scrive inchiostro libero; se è estraneo il
livello della radice, un tratto libero nuovo si rifiuta con l'avviso
`canvas.ink.foreign`. Ogni livello ha il suo stato: due livelli estranei nello
stesso file non toccano gli altri.

## Il tratto che non si disegna

In un livello valido, un tratto che non rispetta le regole qui sopra **si
conserva e non si disegna**, e la gomma non lo vede. La ragione è una parola
fissa, la prima che vale in quest'ordine:

| Ragione | Quando |
|---|---|
| `tool` | `tool` manca o non è `"pen"` né `"highlighter"` |
| `anchor` | `anchor` manca, non è un oggetto, ha un `kind` sconosciuto o fuori posto, o una misura che manca o non è un numero maggiore di zero |
| `color` | `color` manca o non è `#rrggbb` |
| `brush` | `brush` manca o non è un pennello valido della §5 |
| `ink` | `ink` manca, non rispetta la grammatica o i limiti della §5, o ha un canale sconosciuto |

## I limiti

- **Per tratto:** quelli della §5, al massimo 10 000 campioni e 512 KiB della
  stringa `ink`. Un tratto letto oltre i limiti non si disegna (ragione
  `ink`).
- **Per file:** 16 MiB di sorgente (`MAX_CANVAS_SOURCE_BYTES` in
  `apps/client/src/editors/canvas/model.ts`).
- **Un tratto nuovo** che supera un limite si rifiuta con l'avviso
  `canvas.ink.full`, e il file non cambia.

## Scrittura

- **Ordine dei campi del tratto:** `id`, `tool`, `at`, `brush`, `color`,
  `anchor`, `ink`, poi gli sconosciuti nell'ordine in cui erano.
- **Ordine dei campi dell'ancora:** `kind`, `width`, `height`, poi gli
  sconosciuti.
- **Il primo tratto** di una scheda o della radice crea il livello
  `{"v": 1, "strokes": [...]}` in fondo ai campi di chi lo tiene.
- **L'ultimo tratto tolto:** se il livello resta esattamente
  `{"v": 1, "strokes": []}`, la chiave `fub:ink` sparisce. Se il livello ha
  altri campi, resta. Annullare rimette la chiave in fondo ai campi della
  scheda: il modello torna uguale per valore.
- **Il resto del file** non cambia: spostare o ridimensionare una scheda non
  scrive niente per l'inchiostro, e un tratto nuovo tocca solo il suo livello.

## Obsidian

Obsidian apre la stessa lavagna e non conosce i campi `fub:ink`.

- **Che cosa si sa:** niente. Se Obsidian, quando riscrive il file, conserva
  i livelli, li riordina o li perde lo dice soltanto una prova con Obsidian
  vero, e finché non c'è l'[ADR 0241](../decisions/0241-inchiostro-sulla-lavagna.md)
  resta proposta. Un riordino delle chiavi, o `640.0` al posto di `640`, non
  conta: i livelli si confrontano per valore.
- **Come si prova:** col kit in `tools/prova-obsidian/`
  ([istruzioni](../../tools/prova-obsidian/README.md)). Si copia la lavagna di
  prova in un vault di prova vuoto, la si apre in Obsidian, si sposta una
  scheda e se ne ridimensiona un'altra, si salva e si lancia `confronta.mjs`
  sul file di prima e su quello di dopo. Lo script dice, per ogni livello
  (scheda per scheda, la radice e il `fub:ink` dell'arco), se c'è ancora, se
  è uguale per valore o che cosa è cambiato, e se la scheda si è spostata o
  ridimensionata; esce con 0 solo se ogni livello è intatto.
- **Che cosa decide:** se ogni livello resta uguale per valore, la forma di
  questa pagina resta l'unica copia dell'inchiostro (strada A). Se Obsidian
  perde o cambia i livelli, anche solo sulle schede che sposta, la decisione
  diventa A più una copia B: un SVG accanto alla lavagna, che gli altri
  programmi sanno mostrare (fra le alternative dell'ADR 0241), scritto da Fub
  in più; i campi `fub:ink` restano la fonte.

## Toppa e operazioni

Le toppe e le operazioni della lavagna sono nelle [operazioni sulla
lavagna](canvas-operations.md); qui ci sono quelle dell'inchiostro, che il
nucleo applica e disfa come le altre.

L'inchiostro di una lavagna sta nei livelli `fub:ink` delle schede e della
radice, nel formato [qui sopra](#il-livello). Un livello si indica con `"board"` (la radice) o `{"node": "<id>"}` (una scheda
di ogni tipo, gruppi compresi).

### La toppa `ink`

`{"kind": "ink", "layer", "at", "before", "after"}` aggiunge (`before`
uguale a `null`), toglie (`after` uguale a `null`) o cambia il tratto alla
posizione `at` dei tratti del livello. Un tratto è scritto come nel file, e
si confronta per valore come le schede. Un tratto nuovo può andare alla fine
(`at` uguale al numero dei tratti), non oltre.

```json
{ "kind": "ink", "layer": { "node": "f1" }, "at": 0, "before": null,
  "after": { "id": "s1", "tool": "pen", "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
             "color": "#0072b2", "anchor": { "kind": "card", "width": 640, "height": 420 },
             "ink": "1 s100 cxy 100,100 10,0" } }
```

- **Il livello nasce** con la prima toppa: una scheda senza `fub:ink` lo
  prende in fondo ai suoi campi.
- **L'ultimo tratto tolto**: se il livello resta esattamente
  `{"v": 1, "strokes": []}`, la chiave sparisce; l'annulla la rimette in
  fondo ai campi della scheda. Un livello con altri campi resta, vuoto.
- **Un livello estraneo** non si tocca (`ForeignLayer`, ragione `invalid`).
  Una scheda che non c'è o un'immagine di prima che non torna sono `Stale`.
- Il sorgente si ritocca tratto per tratto: gli array di oggetti con `id` si
  accoppiano per id a ogni profondità, quindi un tratto nuovo su una scheda
  con 2000 tratti aggiunge al file solo quel tratto e il separatore
  (`tests/ink_patch.rs`).
- Spostare o ridimensionare una scheda resta un `upsert-node`: il file cambia
  solo in `x`, `y`, `width` o `height`, ma la toppa porta il livello intero,
  prima e dopo.

### `add_strokes`

Aggiunge i tratti `strokes` in fondo al livello `layer`, nell'ordine dato:
una toppa `ink` per tratto. Ogni tratto è come nel file, campi sconosciuti
compresi; `id` è facoltativo (assente o `null`: lo dà il seme, saltando gli
id del livello). Un tratto che non si disegnerebbe in quel livello (per
esempio un'ancora `free` su una scheda) è `Invalid`; un id che il livello ha
già è `DuplicateId`; una scheda che non c'è è `UnknownNode`.

```json
{ "op": "add_strokes", "layer": "board",
  "strokes": [{ "tool": "pen", "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
                "color": "#0072b2", "anchor": { "kind": "free" }, "ink": "1 s100 cxy 4000,2500 120,40 95,-10" }] }
```

### `erase_strokes`

Cancella dal livello `layer` i tratti `ids`, in un ordine qualunque: una
toppa `ink` per tratto, con la posizione che il tratto ha dopo le
cancellazioni prima di lui, così l'inversa li rimette tutti al loro posto.
Un id che non c'è è `UnknownStroke`, uno ripetuto `DuplicateId`. Un tratto
che Fub non sa disegnare si conserva e non si cancella: `Invalid`.

```json
{ "op": "erase_strokes", "layer": { "node": "f1" }, "ids": ["s1", "s3"] }
```

`move` e `resize` non toccano l'inchiostro: i punti di una scheda sono in
unità della scheda, e la resa li porta alla misura di adesso come dice
[«La misura della scheda»](#la-misura-della-scheda). `remove` porta
via l'inchiostro della scheda con lei, e l'annulla lo rimette. I vettori
sono `apps/client/src/__fixtures__/canvas-patches/*-ink-*.json` e
`canvas-ops/*strokes*.json`, `canvas-ops/*-card-with-ink.json`.

## I vettori

`apps/client/src/__fixtures__/canvas-ink/` tiene un vettore per file, la prova
comune di ogni lettore del formato. Ogni vettore è un oggetto JSON:

```json
{
  "name": "card-on-board",
  "description": "Un'ancora card vale solo nel livello di una scheda …",
  "source": "{\n  \"nodes\": [],\n  …",
  "expect": { "layers": [
    { "layer": "board", "state": "ok", "strokes": [
      { "id": "s-1", "drawn": false, "reason": "anchor" },
      { "id": "s-2", "drawn": true } ] } ] }
}
```

- **`name`:** il nome del file senza `.json`.
- **`source`:** il testo grezzo del `.canvas`, BOM e a capo compresi.
- **`layers`:** i livelli presenti, nell'ordine delle schede in `nodes`, poi
  la radice. Una scheda o una radice senza `fub:ink` non compare.
- **`layer`:** `"board"` per la radice, `{"node": "<id>"}` per una scheda.
- **`state`:** `"ok"` o `"foreign"`. Un livello `"foreign"` ha `strokes`
  vuoto.
- **`strokes`:** i tratti di un livello `"ok"`, nell'ordine dell'array, con
  `drawn` e, se il tratto non si disegna, `reason`.

I vettori sono scritti a mano. I limiti di dimensione si provano nei test
d'unità dei lettori, perché un vettore da 512 KiB non sta nel repository.

Il lettore è uno solo, il nucleo Rust (`crates/fub-canvas-core/src/ink.rs`,
`read_layers`): `crates/fub-canvas-core/tests/ink_vectors.rs` fa girare i
vettori in nativo. Il client non ha una copia delle regole: legge i livelli
per `.wasm` (`canvas_ink_layers`, in
[Operazioni sulla lavagna](canvas-operations.md#webassembly)), e
`expect` è proprio la forma della risposta. `crates/fub-canvas-wasm/tests/`
fa girare i vettori attraverso la facciata, nelle sue due vie, e
`apps/client/src/editors/canvas/wasm/ink-vectors.test.ts` attraverso il
`.wasm` vero, dove prova anche che ogni tratto che il nucleo dice da
disegnare il codec TypeScript lo sa decodificare. Lo stesso test conta i
vettori dell'inchiostro di `canvas-patches/` e `canvas-ops/`, che passano
da `wasm/vectors.test.ts` con gli altri.
