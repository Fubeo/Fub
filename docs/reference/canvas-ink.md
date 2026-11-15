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
| `{"kind": "page", "page": N, "width": W, "height": H}` | solo nel livello di una scheda | punti PDF dall'angolo in alto a sinistra della pagina `N` (sotto, «L'ancora di pagina») |
| `{"kind": "cell", "sheet": F, "cell": C}` | solo nel livello di una scheda | pixel del foglio al 100% dall'angolo in alto a sinistra della cella `C` del foglio `F` (sotto, «L'ancora di cella») |

- **`W`, `H`:** la misura della scheda quando il tratto si è scritto, numeri
  finiti maggiori di zero. Dicono in che unità sono i punti; come seguono la
  misura di adesso lo dice «La misura della scheda». Si confrontano per valore: `640.0` e `6.4e2` sono
  640.
- **Fuori posto:** un'ancora `card`, `page` o `cell` alla radice, o `free` su una
  scheda, non è valida, e il tratto non si disegna.
- **Altri campi dell'ancora:** si conservano dopo quelli noti e non cambiano
  il significato.
- **Un `kind` sconosciuto** (di una versione più nuova): il tratto si
  conserva com'è e non si disegna. Il perché delle ancore di contenuto sta
  nell'[ADR 0243](../decisions/0243-le-ancore-di-contenuto.md).

### L'ancora di pagina

Un tratto scritto sulla pagina di una scheda PDF è della pagina, non della
scheda: i punti sono in punti PDF dall'angolo della pagina, e si vede solo
quando la scheda mostra quella pagina. Le regole: [L'ancora di
pagina](canvas-ink-anchors.md#lancora-di-pagina).

### L'ancora di cella

Un tratto scritto sopra la griglia di una scheda di foglio è della cella sotto
il centro del suo riquadro: i punti sono in pixel del foglio al 100%
dall'angolo della cella, e il tratto segue la cella quando il foglio scorre.
Le regole: [L'ancora di cella](canvas-ink-anchors.md#lancora-di-cella).

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
  di posizione, e ciò che esce si vede, non si taglia (un tratto di pagina o
  di cella invece si taglia alla scheda, sopra).

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
- **Il contenuto (`scale` con la proporzione):** quando la resa sa la
  proporzione `a` (larghezza / altezza) del contenuto che la scheda mostra
  (l'immagine, o la zona che ne mostra; la pagina intera del PDF), il
  tratto segue il contenuto e non la scheda. Il contenuto sta centrato e
  intero: in `W × H` è `C = (W − c) / 2, (H − c / a) / 2, c × c / a` con
  `c = min(W, H · a)`, in `w × h` è `D` allo stesso modo. Allora
  `s = D.w / C.w`, `dx = D.x − s · C.x`, `dy = D.y − s · C.y`. Esempio:
  un PDF A4 (`a = 0,7071`) scritto su `400 × 400` e visto su `400 × 800`
  ha `C = 58,6, 0, 282,8 × 400` e `D = 0, 117,2, 400 × 565,7`, quindi
  `s = 1,414`, `dx = −82,8`, `dy = 117,2`. Una proporzione assente, zero,
  negativa o non finita torna alla regola di sopra; con `a = W / H` le due
  regole danno lo stesso. Il file non scrive `a`: la sa solo chi ha il
  contenuto, e il client la dà al nucleo nelle operazioni che portano un
  tratto (`aspect` di `move_strokes` e `restyle_strokes`); senza, il nucleo
  usa la regola senza proporzione.
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
`s`, `x` (`dx`), `y` (`dy`) e qualche punto `from` → `to`. Il nucleo Rust
li fa girare con `ink_fit`. Quelli con la proporzione stanno accanto, in
`canvas-ink-fit-aspect/`, con il campo in più `aspect`: li provano il
client (`ink-fit.test.ts`) e il nucleo, con `ink_fit` e la proporzione.

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
| `anchor` | `anchor` manca, non è un oggetto, ha un `kind` sconosciuto o fuori posto, una misura che manca o non è un numero maggiore di zero, (`page`) una pagina che non è un intero da 1 in su, o (`cell`) un foglio vuoto o una cella che non è A1 |
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
- **Ordine dei campi dell'ancora:** `kind`, `page` (solo l'ancora di
  pagina), `width`, `height`, poi gli sconosciuti; per l'ancora di cella
  `kind`, `sheet`, `cell`, poi gli sconosciuti.
- **Il primo tratto** di una scheda o della radice crea il livello
  `{"v": 1, "strokes": [...]}` in fondo ai campi di chi lo tiene.
- **L'ultimo tratto tolto:** se il livello resta esattamente
  `{"v": 1, "strokes": []}`, la chiave `fub:ink` sparisce. Se il livello ha
  altri campi, resta. Annullare rimette la chiave in fondo ai campi della
  scheda: il modello torna uguale per valore.
- **I pezzi della gomma che taglia:** ogni pezzo è un tratto nuovo al posto
  di quello tagliato, nel suo ordine, con un id nuovo, gli stessi campi
  (anche gli sconosciuti), `at` spostato all'inizio del pezzo se c'era, il
  suo `ink` e, ai tagli, `taperStart` o `taperEnd` a 0.
- **Il resto del file** non cambia: spostare o ridimensionare una scheda non
  scrive niente per l'inchiostro, e un tratto nuovo tocca solo il suo livello.

## Obsidian

Obsidian apre la stessa lavagna e non conosce i campi `fub:ink`: non disegna
l'inchiostro, ma quando riscrive il file lo conserva.

- **Che cosa si è visto:** il 2026-11-14, con Obsidian 1.13.7, la lavagna di
  prova aperta in un vault vuoto, una scheda spostata e una ridimensionata,
  poi salvata da Obsidian: ogni livello è rimasto uguale per valore, sulle
  schede (anche quelle mosse), sulla radice, sul livello estraneo (`v: 2`,
  coi campi sconosciuti dentro un tratto) e sul `fub:ink` dell'arco. Un
  riordino delle chiavi, o `640.0` al posto di `640`, non conta: i livelli si
  confrontano per valore. Il resoconto è nella «Verifica» dell'[ADR
  0241](../decisions/0241-inchiostro-sulla-lavagna.md).
- **Che cosa ne segue:** la forma di questa pagina è l'unica copia
  dell'inchiostro. Fub non scrive un disegno in più per gli altri programmi.
- **Come si rifà la prova** (per esempio con una versione nuova di Obsidian):
  col kit in `tools/prova-obsidian/`
  ([istruzioni](../../tools/prova-obsidian/README.md)). Si copia la lavagna di
  prova in un vault di prova vuoto, la si apre in Obsidian, si sposta una
  scheda e se ne ridimensiona un'altra, si salva e si lancia `confronta.mjs`
  sul file di prima e su quello di dopo. Lo script dice, per ogni livello
  (scheda per scheda, la radice e il `fub:ink` dell'arco), se c'è ancora, se
  è uguale per valore o che cosa è cambiato, e se la scheda si è spostata o
  ridimensionata; esce con 0 solo se ogni livello è intatto.

## Il Lazo

Il Lazo (`canvas.tool.lasso`, tasto `Q`, in tendina sotto la Selezione nella
[colonna degli strumenti](canvas-input.md#la-colonna-degli-strumenti))
sceglie schede e tratti con un giro a mano libera (`lasso.ts`, pura). La riga
delle opzioni spiega il gesto finché non c'è una scheda scelta.

- **Il giro** si chiude da solo e segue la regola pari-dispari. Una scheda è
  dentro se lo è tutto il suo rettangolo, un tratto se lo sono tutti i suoi
  punti. Un tratto di una scheda scelta non si sceglie: va con lei. Un
  livello estraneo, un tratto che non si disegna e un tratto di pagina o di
  cella (sopra, «L'ancora») non si scelgono. Con
  `Maiusc` il giro aggiunge alla scelta; un clic senza giro sceglie la
  scheda sotto, o toglie la scelta. `Esc` e un altro strumento la tolgono.
- **I tratti scelti** hanno il contorno d'accento e una cornice tratteggiata
  attorno (`.canvas-lasso`, sullo stage sopra l'inchiostro).
- **Trascinare** dentro la scelta sposta schede e tratti insieme; gli
  originali restano attenuati sotto finché la mano non si alza. Come
  [mentre la penna scrive](canvas-input.md#mentre-la-penna-scrive), la cornice
  e l'etichetta dicono a quale scheda i tratti passeranno, con la stessa
  regola dell'ancora; con `Alt` restano liberi.
- **All'alzata** un commit solo (`move` per le schede, `move_strokes` per
  livello) che «Annulla» riporta uguale. Se i tratti passano a un'altra
  scheda, un avviso dice «Ora fa parte di {nome}» con «Annulla» e «Rendilo
  libero» (li riporta sulla radice, dove sono).
- **La barra della selezione** con dei tratti scelti ha il colore (la tavolozza
  della penna) e lo spessore (il cursore della penna) dei tratti: ogni scelta
  è un `restyle_strokes`, un passo d'annulla. I pulsanti delle schede restano
  solo se ci sono schede scelte.
- **In sola lettura** il Lazo sceglie ma non sposta e non cambia.

## Le forme, Maiusc e il righello

Una forma resta un tratto `fub:ink` (D-22): nessun campo e nessun formato
nuovo. La guida del tratto in corso è `StrokeGuide` (`ink-shapes.ts`); il
riconoscimento e il righello sono quelli del disegno (`recognize.ts`,
`ruler.ts`), importati come funzioni pure.

- **La penna ferma.** Un tratto a penna tenuto fermo mezzo secondo alla fine
  diventa la forma a cui somiglia: linea, freccia, rettangolo, ellisse,
  poligono o stella. Sotto 40 pixel sullo schermo resta inchiostro: è la
  misura della scrittura. La scia mostra subito la forma e il lettore di
  schermo la sente; finché la penna resta giù, muoverla la regola come nel
  disegno e `Maiusc` la fa regolare. L'evidenziatore, un tratto sul righello
  e un tratto spezzato al limite dei campioni non diventano forme.
- **All'alzata, due passi.** Prima il tratto com'era, poi una toppa `ink` che
  ne cambia l'`ink` al suo posto: stesso `id`, `tool`, `at`, `brush`,
  `color` e `anchor`. Il primo annulla riporta il tratto, il secondo lo
  toglie. I campioni corrono lungo il contorno a passi di 1,5 unità con la
  pressione mediana del tratto; la freccia è l'asta e la punta in un tratto
  solo, con la punta del disegno.
- **Maiusc** durante il tratto lo scrive dritto dal primo punto all'ultimo, a
  passi di 15°; premuto a metà tratto, la scia si raddrizza subito.
- **Il righello** («Righello» nella colonna) sta sopra la lavagna e non entra
  nel file. È largo 72 pixel dello schermo a ogni zoom; il corpo si sposta,
  la rotella e le frecce lo girano a gradi, con `Maiusc` a passi di 15°, e
  `Inizio` lo raddrizza. Un tratto che comincia entro 16 pixel da un bordo (12
  col mouse, 24 col dito) lo segue: ogni campione va sul bordo, scostato di
  mezza punta.
- **La latenza.** A ogni campione la guida guarda solo se la punta è uscita
  dal punto fermo; la forma si cerca una volta, quando il mezzo secondo è
  passato.

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

### `move_strokes`

Sposta i tratti `ids` del livello `layer` di `dx`, `dy`, in unità della
lavagna (numeri finiti, altrimenti `Invalid`). È l'operazione del Lazo.

- **Nello stesso livello** (`to` assente o uguale a `layer`) cambia solo
  `ink`, una toppa `ink` per tratto al suo posto. Lo spostamento si porta
  nelle unità dell'ancora e si arrotonda all'intero, e tutti i punti si
  spostano di quello: la forma resta identica e cambia solo il primo
  campione.
- **In un altro livello** (`to`) i tratti escono da `layer` come con
  `erase_strokes` ed entrano in fondo a `to`, nell'ordine dato, con
  l'ancora nuova: `card` alla misura di adesso della scheda, o `free` sulla
  radice. I punti si riportano nelle unità della nuova ancora con
  [«La misura della scheda»](#la-misura-della-scheda) (un tratto del PDF
  che passa a una nota cambia scala), arrotondati all'intero; lo spessore
  del pennello segue la stessa scala. Un id che `to` ha già ne prende uno
  nuovo dal seme, e `created` lo dice.
- **La proporzione del contenuto** (`aspect`, facoltativo): quella che la
  scheda di `layer` mostra, se il client la sa. Il nucleo porta il tratto
  come la resa, con [il contenuto](#la-misura-della-scheda), così col Lazo
  il tratto va dove dice il puntatore anche su una scheda ridimensionata con
  un'altra proporzione. Assente, zero o negativa: la regola senza
  proporzione, come prima. Non conta sulla radice né sulle schede `fixed`,
  e non si scrive nel file.
- **Gli errori:** un id che non c'è è `UnknownStroke`, uno ripetuto
  `DuplicateId`; un tratto che Fub non sa disegnare si conserva (`Invalid`),
  e così uno che nel livello nuovo non si disegnerebbe; un livello estraneo,
  da una parte o dall'altra, è `ForeignLayer`.

```json
{ "op": "move_strokes", "layer": { "node": "pdf1" }, "ids": ["s1"],
  "dx": 40, "dy": -12, "to": { "node": "nota1" }, "aspect": 0.7071 }
```

### `restyle_strokes`

Cambia il colore (`color`, `#rrggbb`) e lo spessore del pennello (`size`,
in unità della lavagna) dei tratti `ids` del livello `layer`: almeno uno dei
due, altrimenti `Invalid`, e `size` è un numero finito maggiore di zero.
Una toppa `ink` per tratto al suo posto; un tratto che resta uguale non ne
ha. Lo spessore cambia la voce `size=` del pennello dove sta scritta, le
altre voci restano come sono. Sul tratto di una scheda che scala, `size` si
divide per il fattore della scheda (con `aspect`, facoltativo, come in
`move_strokes`), così il tratto si vede come è chiesto. Gli errori sugli id
sono quelli di `move_strokes`.

```json
{ "op": "restyle_strokes", "layer": "board", "ids": ["s1", "s3"],
  "color": "#d55e00", "size": 6 }
```

`move` e `resize` non toccano l'inchiostro: i punti di una scheda sono in
unità della scheda, e la resa li porta alla misura di adesso come dice
[«La misura della scheda»](#la-misura-della-scheda). `remove` porta
via l'inchiostro della scheda con lei, e l'annulla lo rimette. I vettori
sono `apps/client/src/__fixtures__/canvas-patches/*-ink-*.json` e
`canvas-ops/*strokes*.json`, `canvas-ops/*-card-with-ink.json`.

## In codice

Un modello non sa scrivere la stringa `ink`. Per questo c'è `draw`, che scrive
**un** tratto dai punti o da una forma, con la penna e il colore per nome. Il
nucleo fa ciò che fa la tela quando la penna si alza
(`crates/fub-canvas-core/src/ops/draw.rs`).

```json
{ "op": "draw", "on": "t1", "shape": { "kind": "ellipse", "x": 8, "y": 8, "width": 304, "height": 144 },
  "pen": "marker", "color": "vermilion" }
```

### `draw`

| Campo | Di serie | Valore |
|---|---|---|
| `on` | `"auto"` | di chi è il tratto e in che coordinate sono i punti, qui sotto |
| `points` | — | `[[x, y], …]` o `[[x, y, pressione], …]`, la pressione da 0 a 1 |
| `shape` | — | una forma, qui sotto; va senza `points`, e uno dei due ci vuole |
| `pen` | `ballpoint` | una delle sette penne di `apps/client/src/ink/pens.ts` |
| `size` | la misura della penna | da 0,25 a 200, in unità dell'ancora |
| `color` | blu (`#0072b2`); giallo (`#f0e442`) con `highlighter` | un nome della tavolozza (`black`, `blue`, `vermilion`, `green`, `purple`, `orange`, `sky`, `yellow`) o `#rrggbb`, scritto minuscolo |
| `id` | dal seme | l'id del tratto, unico nel livello |

- **`on: "auto"`:** i punti sono della lavagna. Il tratto va alla scheda
  che lo prenderebbe con la penna: la regola di `anchorAt`
  (`apps/client/src/editors/canvas/anchor.ts`), portata in
  `ops/anchor.rs`. Conta solo la scheda più in alto che il riquadro del
  tratto tocca, allargato di metà misura. La scheda lo prende se contiene il
  centro del riquadro e almeno metà della sua area, e se il suo livello non
  è estraneo. Altrimenti il tratto resta libero. Una scheda prende i punti
  meno il suo angolo, con l'ancora `card` della sua misura di adesso.
- **`on: "board"`:** il tratto è libero, anche sopra una scheda, come la
  penna con Alt.
- **`on` con l'id di una scheda:** i punti sono già nelle sue unità, con 0,0
  in alto a sinistra, e l'ancora è `card` alla sua misura di adesso. Vale
  anche per un gruppo. Un id che non c'è è `UnknownNode`, un livello
  estraneo `ForeignLayer`. `auto` e `board` sono parole: una scheda con
  quell'id si raggiunge solo con `auto`.
- **La pagina e la cella** (`{card, page}`, `{card, sheet, cell}`) non ci
  sono: un oggetto in `on` non si legge.

Le forme, nelle coordinate di `on`:

| `kind` | Campi | Punti |
|---|---|---|
| `line` | `x1`, `y1`, `x2`, `y2` | da un capo all'altro |
| `arrow` | `x1`, `y1`, `x2`, `y2` | l'asta fino alla cima, poi un'ala della punta (30°, lunga `max(12, 3 · size)`) e indietro, poi l'altra e indietro; i capi devono essere diversi |
| `rect` | `x`, `y`, `width`, `height` | dall'angolo in alto a sinistra in senso orario, chiuso |
| `ellipse` | `x`, `y`, `width`, `height` | dall'alto in senso orario, almeno 64 parti, chiusa |
| `polygon` | `points` | i vertici, almeno 3, poi di nuovo il primo |
| `star` | `cx`, `cy`, `r`, `tips` | una punta in alto, poi un vertice interno a `r / 2` e una punta, chiusa; almeno 3 punte |

- **I campioni:** ogni lato si divide in parti uguali non più lunghe di 4
  unità, e l'ellisse in parti non più lunghe di 4 sulla sua circonferenza.
  Un lato lungo zero non aggiunge campioni. La pressione è 0,5, se un punto
  non la dà. Il tempo è sintetico: 8 ms per campione, dal primo a 0, e il
  tratto non ha `at` (il nucleo non ha orologio).
- **Il tratto:** i punti si quantizzano in `s100` coi canali `xypt`. Il
  pennello è quello che la GUI scrive con la stessa penna e la stessa misura
  (`pen_brush` di `fub-ink-codec`, specchio di `penBrush`), per un tratto con
  la pressione: `sim=0`. Lo strumento lo dà la penna. Il tratto entra poi
  come con `add_strokes`, in fondo al livello e con lo stesso ordine dei
  campi.
- **Gli errori:** `points` e `shape` insieme, nessuno dei due, nessun punto,
  un punto che non è `[x, y]` o `[x, y, p]`, una pressione fuori da 0…1, una
  freccia coi capi uguali, misure negative, meno di 3 vertici o di 3 punte,
  un raggio non positivo: `Invalid`. Più di 10 000 punti, dati o fatti da
  una forma, sono `TooMany`, contati prima di farli. Una penna, una misura,
  un colore o una forma che non ci sono non si leggono: `validate` dà
  `bad_value`, coi nomi vicini (`vermillion` → `vermilion`). `cyan` è un
  colore di scheda, non d'inchiostro.

I casi della regola dell'ancora sono in
`apps/client/src/__fixtures__/ink-anchor.json`, scritti a mano: li fanno
girare i test di `ops/anchor.rs` e
`apps/client/src/editors/canvas/anchor-vectors.test.ts`, contro `anchor.ts`.
I vettori di `draw` sono `canvas-ops/draw-*.json`.

### Leggere

Le tre letture della lavagna ([La lavagna come codice](canvas-code.md#leggere))
dicono anche l'inchiostro, con le regole di questa pagina: le stesse di
`crates/fub-canvas-core/src/describe/ink.rs`.

- **Le coordinate.** I punti di un tratto di una scheda sono nelle coordinate
  della scheda com'è adesso, con 0,0 nell'angolo in alto a sinistra: la misura
  dell'ancora si porta a quella di adesso come in [«La misura della
  scheda»](#la-misura-della-scheda), e con `scale` anche lo spessore. Il modo
  è quello della resa (`inkFitMode`): un `#` nel campo `file` non taglia il
  nome, quindi `foto#1.png` scala anche se la sua specie di scheda è `file`.
  Quelli di un tratto libero sono nelle coordinate della lavagna. Punti e
  riquadri si arrotondano a 0,1, lo spessore `size` a 0,01; il riquadro va dal
  punto più in alto a sinistra a quello più in basso a destra, senza lo
  spessore.
- **L'outline.** La riga di una scheda con l'inchiostro finisce con
  `ink=N [bad=M] x y larghezza×altezza`: i tratti del livello, quanti non si
  disegnano (un'ancora fuori posto si conta qui) e il riquadro di quelli che si
  disegnano, o `-` se nessuno. Un livello estraneo è `ink=foreign`.
  L'inchiostro libero è la riga `ink board …`, con le stesse parti, subito dopo
  i conti. Con `ids` la riga libera non c'è. Gli archi non hanno livelli.

```text
cards 2 edges 0 groups 0 bounds 0 0 980×420
ink board 1 40 25 2.2×0.4
1 f1 sheet "Corsi/Statistica/voti.xlsx" 0 0 640×420 ink=1 120.5 30.1 0.6×0.1
2 n2 text "Perché la media è così bassa?" 700 40 280×90
```

- **Il codice.** Dopo la `add_card` di una scheda viene la `add_strokes` del
  suo livello, con ogni tratto com'è nel file: le stringhe `brush` e `ink`
  esatte, `at` e i campi sconosciuti. L'inchiostro libero è l'ultima
  `add_strokes`, sulla radice. Un livello che `add_strokes` non ricrea uguale,
  chiavi nello stesso ordine (estraneo, con un tratto che non si disegna, con
  campi in più, vuoto, con `v` scritto `1.0`, con le chiavi di un tratto in un
  ordine diverso da [«Scrittura»](#scrittura), o seguito da un altro campo
  della scheda) resta dentro la scheda intera, com'è; uno della radice
  non sta nel codice, come gli altri campi sconosciuti della radice. `draw` è
  per scrivere, non per rileggere.
- **Il modello.** `json` tiene ogni `fub:ink` com'è nel file: una scheda
  letta e rimandata con `set` porta il suo inchiostro intatto. La lettura sta
  accanto, in `ink_read` (`describe::ink_read`; in `canvas.read` è il campo
  `ink_read` del payload), ed è solo da leggere: non è il formato del file, e
  scritta in una scheda sarebbe un campo sconosciuto. È un oggetto per
  livello, `{layer, state, strokes}`, nell'ordine dei vettori: le schede
  nell'ordine di `nodes`, poi la radice (non con `ids`). `layer` è `"board"`
  o `{"node": id}`, `state` è `ok` o `foreign` (un livello estraneo ha
  `strokes` vuoto). Un tratto che si disegna è
  `{id, color, size, tool, pen?, bounds, points}`, con `pen` dal `pen=<id>`
  del pennello, `bounds` come `{x, y, width, height}` e `points` come
  `[[x, y], …]`; uno che non si disegna è `{id, bad}`, con la ragione.
- **`max_chars`** taglia soltanto i punti di `ink_read`, mai il modello. Se la
  lettura scritta come JSON compatto supera il limite, si mostrano i primi
  punti nell'ordine dei tratti finché ci stanno: ogni tratto resta, col suo
  `bounds` intero, e `points_omitted` dice quanti punti mancano. Se la lettura
  senza punti supera già il limite, i tratti escono senza punti. In
  `canvas.read` il limite di serie è 20 000, come per l'outline.

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
