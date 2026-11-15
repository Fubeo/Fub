# L'inchiostro in codice

> **Ambito:** l'inchiostro della lavagna scritto e letto come codice:
> le operazioni `draw` ed `erase_along` e le tre letture (outline, codice, modello). Versione 1.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/ops/draw.rs`, `ops/erase.rs`,
> `crates/fub-canvas-core/src/describe/ink.rs` e i vettori in
> `apps/client/src/__fixtures__/canvas-ops/`.

Il formato dell'inchiostro (il livello, il tratto, le ancore, come si disegna)
sta in [L'inchiostro della lavagna](canvas-ink.md), le operazioni grezze
(`add_strokes`, `erase_strokes`, `move_strokes`, `restyle_strokes`) in
[Toppa e operazioni](canvas-ink.md#toppa-e-operazioni), le altre operazioni in
[La lavagna come codice](canvas-code.md#le-operazioni).

Un modello non sa scrivere la stringa `ink`. Per questo c'è `draw`, che scrive
**un** tratto dai punti o da una forma, con la penna e il colore per nome. Il
nucleo fa ciò che fa la tela quando la penna si alza
(`crates/fub-canvas-core/src/ops/draw.rs`).

```json
{ "op": "draw", "on": "t1", "shape": { "kind": "ellipse", "x": 8, "y": 8, "width": 304, "height": 144 },
  "pen": "marker", "color": "vermilion" }
```

## `draw`

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
  meno il suo angolo, con l'ancora `card` della sua misura di adesso. Anche
  su un PDF o un foglio: la pagina o la cella sotto la penna, che la tela
  sceglie (`pageAnchorAt`, `cellAnchorAt`), le sa la resa; per attaccare il
  tratto a loro si scrive `on` con la pagina o la cella.
- **`on: "board"`:** il tratto è libero, anche sopra una scheda, come la
  penna con Alt.
- **`on` con l'id di una scheda:** i punti sono già nelle sue unità, con 0,0
  in alto a sinistra, e l'ancora è `card` alla sua misura di adesso. Vale
  anche per un gruppo. Un id che non c'è è `UnknownNode`, un livello
  estraneo `ForeignLayer`. `auto` e `board` sono parole: una scheda con
  quell'id si raggiunge solo con `auto`.
- **`on` sulla pagina di un PDF** (`{"card", "page", "page_size"?,
  "page_count"?}`): i punti sono punti PDF dall'angolo in alto a sinistra
  della pagina `page` (da 1), come si vede, e l'ancora è
  `{"kind": "page", "page", "width", "height"}` di N6 T19, con la misura
  `page_size` (`[larghezza, altezza]` in punti). Anche `size` è in punti.
  `canvas.apply` e gli altri comandi leggono dal PDF il conto delle pagine
  (`page_count`: se il file si legge vince lui, con l'avviso
  `page_count_from_file`) e la misura della pagina `page`, se non è data
  (`crates/fub-features/src/lavagna/prefill.rs`). La scheda deve essere un
  PDF; senza misura (il file non si legge e `page_size` manca), con una
  misura non positiva o una pagina oltre l'ultima, quando il conto si sa,
  è `Invalid`. Dove la pagina sta nella scheda lo sa la resa: il nucleo
  scrive l'ancora, la tela la porta sulla pagina che la scheda mostra.
- **`on` sulla cella di un foglio** (`{"card", "sheet", "cell"}`): i punti
  sono pixel del foglio al 100% dall'angolo in alto a sinistra della cella,
  e l'ancora è `{"kind": "cell", "sheet", "cell"}` di N6 T37. `sheet` è il
  nome del foglio com'è nel file, spazi compresi, non vuoto; `cell` è un
  indirizzo A1 maiuscolo da `A1` a `XFD1048576` (`A0`, `b3`, `$B$3` non si
  leggono: `bad_value`). La scheda deve essere un foglio
  (`xlsx`, `xlsm`, `xltx`, `xltm`), se no `Invalid`.
- Un oggetto in `on` con `page` è una pagina, con `sheet` o `cell` una
  cella; i campi dell'altra forma, o uno senza nessuno dei tre, non si
  leggono.

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
I vettori di `draw` sono `canvas-ops/draw-*.json`;
`apps/client/src/editors/canvas/draw-anchor-parity.test.ts` rilegge quelli
della pagina e della cella con le regole della tela (`decodeStroke`,
`erasableInk`) e li riscrive con la sua penna (`strokeRecord`): la stessa
ancora e gli stessi campioni.

## `erase_along`

La gomma «Solo il pezzo» in codice (`ops/erase.rs`): `points` (da 1 a 10 000
`[x, y]`, se no `Invalid` o `TooMany`), `size` (maggiore di zero), `on` e
`aspect`. Ogni tratto toccato si taglia dove passa il cerchio, e i pezzi
prendono il suo posto.

- **`on`:** `"auto"` (di serie) vuole punti della lavagna e taglia i tratti
  di ogni scheda e quelli liberi; `"board"` solo quelli liberi; l'id di una
  scheda vuole le sue unità (0,0 in alto a sinistra) e taglia solo i suoi
  (`UnknownNode`, `ForeignLayer` come per `draw`). La pagina e la cella si
  scrivono come per `draw`, con gli stessi errori: con la pagina il cammino
  è in punti PDF e taglia solo i tratti di quella pagina della scheda, con
  la cella è in pixel del foglio dalla cella e taglia solo i tratti di
  quella cella (lo stesso foglio e lo stesso indirizzo). Gli altri tratti
  della scheda non si guardano: dove stanno rispetto alla pagina o alla
  cella lo sa la resa, mentre la gomma della tela, che passa sulla scheda,
  taglia anche loro. Un tratto di pagina scritto a un'altra misura (il PDF
  sostituito) si porta su `page_size` come fa la resa (`pageFit`: il
  fattore minore, dall'angolo; `InkFit::on_page`); senza `page_size` il
  cammino è nelle unità dell'ancora di ogni tratto.
- **`aspect`:** la proporzione del contenuto della scheda di `on` (larghezza
  su altezza), come in `move_strokes`: la tela la dà a `erasableInk` con
  `aspects`. Vale solo con `on` sull'id di una scheda (con `auto` o `board` è
  `Invalid`: il cammino passa su più contenuti, e lo è anche con la pagina o
  la cella, che hanno già le loro unità); una che non vale (zero,
  negativa) dà la regola senza. Non si scrive nel file.
- **Il taglio:** il cammino torna nelle unità del tratto con l'inverso della
  sua resa (anche su un'immagine scalata, con `aspect` se c'è), e il raggio, `size / 2` diviso la
  scala, cresce di metà dello spessore del pennello: il conto di `cutInk`,
  con `split_ink` e `cut_brush` (`fub-ink-codec/src/cut.rs`, copia di
  `ink/tools/split.ts`). Un raggio la cui metà arrotonda a zero non taglia.
- **I pezzi:** tutti i campi del tratto, anche gli sconosciuti (nell'ordine
  di `add_strokes`); un id nuovo dal seme, che salta quelli del livello e va
  in `created`; il pennello tagliato, o il testo di prima se il pezzo non
  tocca un taglio; `ink` nella stessa scala. Un pezzo che non si scrive
  toglie il tratto intero, come nella tela; un tratto coperto tutto se ne va.
- **`at`:** se il pezzo comincia dopo il tratto, `at` si sposta dei ms
  arrotondati e si scrive come `toISOString` (`…T09:20:31.276Z`), anche se
  arrotondano a 0. Senza fuso, il nucleo legge solo `YYYY-MM-DD` e
  `YYYY-MM-DDTHH:MM[:SS[.fff…]]` con `Z` o `±HH:MM`, ore 00–23, anni (anche
  dopo) 0–9999: un'ora locale, RFC 2822, `T24:00` o un anno fuori resta
  com'era, dove la tela, con `Date.parse`, lo sposta.
- **Le toppe:** per livello, si tolgono i tratti tagliati dall'ultimo al
  primo e si mettono i pezzi al loro posto (`cutStrokePatches`); niente tocchi, niente toppe.
- **Ciò che resta:** un tratto che non si disegna e un livello estraneo non
  si toccano. Con `auto`, `board` o l'id di una scheda non si tocca nemmeno
  un tratto con l'ancora di pagina o di cella: la pagina che la scheda
  mostra e il riquadro della cella li sa la resa, non il nucleo, e si
  tagliano con `on` sulla loro pagina o sulla loro cella. Se possono stare
  sotto il cammino (per una scheda, se il cammino la tocca; con la pagina o
  la cella, se la loro ancora dice quella pagina o quella cella), la nota
  `ink_kept` lo dice, con la ragione (`anchored to a page`, `anchored to a
  cell`). Oltre 50 milioni di distanze stimate
  (`split_work`) il cammino è troppo fitto: `Invalid`.

`ink-cut.json`, scritto a mano, prova il taglio in Rust (`cut_vectors.rs`) e
contro `split.ts` (`split-vectors.test.ts`); `erase-along-parity.test.ts` rifà
i vettori `canvas-ops/erase-along-*.json` con la gomma della tela (con la
pagina o la cella nell'angolo della scheda, alla scala 1 o a quella di
`page_size`, e solo coi loro tratti).

## Leggere

Le tre letture della lavagna ([La lavagna come codice](canvas-code.md#leggere))
dicono anche l'inchiostro, con le regole di questa pagina: le stesse di
`crates/fub-canvas-core/src/describe/ink.rs`.

- **Le coordinate.** I punti di un tratto di una scheda sono nelle coordinate
  della scheda com'è adesso, con 0,0 nell'angolo in alto a sinistra: la misura
  dell'ancora si porta a quella di adesso come in [«La misura della
  scheda»](canvas-ink.md#la-misura-della-scheda), e con `scale` anche lo spessore. Il modo
  è quello della resa (`inkFitMode`): un `#` nel campo `file` non taglia il
  nome, quindi `foto#1.png` scala anche se la sua specie di scheda è `file`.
  Quelli di un tratto libero sono nelle coordinate della lavagna. Un tratto
  con l'[ancora di pagina o di cella](canvas-ink-anchors.md) resta nelle unità
  della sua ancora (punti PDF della pagina, pixel del foglio dalla cella):
  dove la pagina o la cella sta nella scheda lo sa la resa, non il nucleo,
  come per le operazioni sui tratti. La lettura non applica la proporzione del
  contenuto (`aspect` di `move_strokes` ed `erase_along`): non la sa, e porta
  la misura con la regola senza; su un'immagine con un'altra proporzione i
  punti letti possono non cadere dove la tela li disegna. Punti e
  riquadri si arrotondano a 0,1, lo spessore `size` a 0,01; il riquadro va dal
  punto più in alto a sinistra a quello più in basso a destra, senza lo
  spessore.
- **L'outline.** La riga di una scheda con l'inchiostro finisce con
  `ink=N [bad=M] x y larghezza×altezza`: i tratti del livello, quanti non si
  disegnano (un'ancora fuori posto si conta qui) e il riquadro di quelli che si
  disegnano, o `-` se nessuno; un tratto di pagina o di cella conta in `N`
  ma non entra nel riquadro. Un livello estraneo è `ink=foreign`.
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
  ordine diverso da [«Scrittura»](canvas-ink.md#scrittura), o seguito da un altro campo
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
  `{id, color, size, tool, pen?, anchor?, bounds, points}`, con `pen` dal
  `pen=<id>` del pennello, `anchor` solo per un tratto di pagina
  (`{"kind": "page", "page"}`) o di cella (`{"kind": "cell", "sheet",
  "cell"}`), `bounds` come `{x, y, width, height}` e `points` come
  `[[x, y], …]`; uno che non si disegna è `{id, bad}`, con la ragione.
- **`max_chars`** taglia soltanto i punti di `ink_read`, mai il modello. Se la
  lettura scritta come JSON compatto supera il limite, si mostrano i primi
  punti nell'ordine dei tratti finché ci stanno: ogni tratto resta, col suo
  `bounds` intero, e `points_omitted` dice quanti punti mancano. Se la lettura
  senza punti supera già il limite, i tratti escono senza punti. In
  `canvas.read` il limite di serie è 20 000, come per l'outline.
