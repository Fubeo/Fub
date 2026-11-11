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
scheda: si vede solo quando la scheda mostra quella pagina.

```json
{ "id": "s-7", "tool": "pen", "brush": "pf1 size=7.9 pen=ballpoint",
  "color": "#0072b2",
  "anchor": { "kind": "page", "page": 3, "width": 595, "height": 842 },
  "ink": "1 s100 cxy 9917,11900 120,40 95,-10" }
```

- **`page`:** la pagina, da 1, un intero per valore (`3`, `3.0`). Zero, un
  numero negativo o non intero, o un valore che non è un numero: l'ancora
  non vale.
- **`width`, `height`:** la misura della pagina in punti PDF (1/72 di
  pollice) quando il tratto si è scritto, la pagina come si vede, con la sua
  rotazione: una A4 ruotata è `842 × 595`. Numeri finiti maggiori di zero,
  anche decimali (`595.276`).
- **I punti** (e lo spessore del pennello) sono in punti PDF dall'angolo in
  alto a sinistra di quella pagina. Un programma che ha il PDF ritrova il
  posto senza sapere come Fub disegna la scheda.
- **Quando nasce:** un tratto che `anchorAt` dà a una scheda PDF e che
  comincia dentro la pagina che la scheda mostra, i bordi compresi. Sopra la
  scheda ma fuori dalla pagina (la testata) prende l'ancora `card`. Conta
  dove comincia: un tratto che parte sulla pagina e ne esce resta della
  pagina.
- **Come si disegna:** solo quando la scheda mostra la pagina `N`, da viva o
  da ferma (l'immagine ferma è quella di una pagina). La pagina `W × H` va
  sul rettangolo dove la scheda la mostra (`pageBox()`, nelle [schede della
  lavagna](canvas-cards.md#il-contratto)) con `s = min(w / W, h / H)`,
  dall'angolo in alto a sinistra: SVG con `viewBox="0 0 W H"` e
  `preserveAspectRatio="xMinYMin meet"`. Ciò che esce dalla pagina si vede
  fino al bordo della scheda, e lì si taglia. Voltata la pagina il tratto
  sparisce; tornati, ricompare. Il file non cambia.
- **Il PDF cambiato:** una pagina con un'altra misura scala il tratto sulla
  pagina nuova (la misura scritta serve a chi non ha il PDF); una pagina che
  non c'è più lascia il tratto nel file, e non si vede.
- **Il nucleo** non sa dove la pagina sta nella scheda: `move_strokes` e lo
  spessore di `restyle_strokes` su un tratto di pagina sono `Invalid`, e il
  Lazo non lo sceglie. La gomma lo prende dove si vede; il colore si cambia.

### L'ancora di cella

Un tratto scritto sopra la griglia di una scheda di foglio è della cella sotto
il centro del suo riquadro: segue la cella quando il foglio scorre.

```json
{ "anchor": { "kind": "cell", "sheet": "Conti 2025", "cell": "B3" } }
```

- **`sheet`:** il nome del foglio com'è nel file, un testo non vuoto, spazi e
  virgolette compresi, senza gli apici delle formule (`Conti 'Q1'`, non
  `'Conti ''Q1'''`). Vuoto o non testo: l'ancora non vale.
- **`cell`:** l'indirizzo in notazione A1, colonna da `A` a `XFD`, riga da 1
  a 1048576, solo maiuscole, senza `$` né zeri davanti: `B3`, `XFD1048576`.
  `A0`, `B`, `b3`, `$B$3`, `B03` o `XFE1`: l'ancora non vale.
- **I punti** (e lo spessore) sono in pixel del foglio al 100% dall'angolo in
  alto a sinistra della cella. Non c'è una misura: il tratto non si stira con
  la cella.
- **Quando nasce:** un tratto che `anchorAt` dà a una scheda di foglio, con
  il centro del suo riquadro su una cella della griglia (`cellAnchorAt`).
  Sopra le intestazioni o fuori dalla griglia prende l'ancora `card`. Sopra
  celle unite prende la cella in alto a sinistra dell'unione.
- **L'indirizzo, non il contenuto.** Il tratto segue il nome della cella. Un
  esempio: un tratto su `B3`; un altro programma inserisce una riga sopra la
  3, e il valore che era in `B3` ora sta in `B4`; il tratto resta su `B3`,
  sopra il valore nuovo. Un foglio rinominato o tolto, o una scheda che non
  è più un foglio: il tratto resta nel file e non si vede, finché un foglio
  con quel nome torna.
- **Il nucleo** non sa dove la cella sta nella scheda: come per la pagina,
  `move_strokes` e lo spessore di `restyle_strokes` sono `Invalid`; il colore
  si cambia e la gomma lo toglie. Il client lo decodifica, ma finché la
  scheda di foglio non dice dove sta la cella non lo disegna né lo prende con
  la gomma o col Lazo.

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
  di posizione, e ciò che esce si vede, non si taglia (un tratto di pagina
  invece si taglia alla scheda, sopra).

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
  contenuto, e il nucleo (`move_strokes`) usa la regola senza proporzione.
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
`canvas-ink-fit-aspect/`, con il campo in più `aspect`: li prova solo il
client (`ink-fit.test.ts`), perché il nucleo non la conosce.

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

## Il Lazo

Il Lazo (`canvas.tool.lasso`, tasto `Q`, in tendina sotto la Selezione nella
[colonna degli strumenti](canvas-input.md#la-colonna-degli-strumenti))
sceglie schede e tratti con un giro a mano libera (`lasso.ts`, pura). La riga
delle opzioni spiega il gesto finché non c'è una scheda scelta.

- **Il giro** si chiude da solo e segue la regola pari-dispari. Una scheda è
  dentro se lo è tutto il suo rettangolo, un tratto se lo sono tutti i suoi
  punti. Un tratto di una scheda scelta non si sceglie: va con lei. Un
  livello estraneo, un tratto che non si disegna e un tratto di pagina
  (sopra, «L'ancora di pagina») non si scelgono. Con
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
- **Gli errori:** un id che non c'è è `UnknownStroke`, uno ripetuto
  `DuplicateId`; un tratto che Fub non sa disegnare si conserva (`Invalid`),
  e così uno che nel livello nuovo non si disegnerebbe; un livello estraneo,
  da una parte o dall'altra, è `ForeignLayer`.

```json
{ "op": "move_strokes", "layer": { "node": "pdf1" }, "ids": ["s1"],
  "dx": 40, "dy": -12, "to": { "node": "nota1" } }
```

### `restyle_strokes`

Cambia il colore (`color`, `#rrggbb`) e lo spessore del pennello (`size`,
in unità della lavagna) dei tratti `ids` del livello `layer`: almeno uno dei
due, altrimenti `Invalid`, e `size` è un numero finito maggiore di zero.
Una toppa `ink` per tratto al suo posto; un tratto che resta uguale non ne
ha. Lo spessore cambia la voce `size=` del pennello dove sta scritta, le
altre voci restano come sono. Sul tratto di una scheda che scala, `size` si
divide per il fattore della scheda, così il tratto si vede come è chiesto.
Gli errori sugli id sono quelli di `move_strokes`.

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
